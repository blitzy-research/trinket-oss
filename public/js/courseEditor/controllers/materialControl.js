(function(angular) {
  'use strict';

  if (!angular) {
    throw new Error('angular required for CourseEditor.materialControl');
  }

  // The number of CONSECUTIVE failed `patchContent` attempts allowed before
  // automatic retrying stops. The retry re-sends the identical patch on a fixed
  // 5000 ms timer without re-fetching the material, so a failure caused by the
  // stored content having diverged (the server refuses the patch and answers
  // 500) is guaranteed to fail identically every time: without a cap an
  // abandoned tab issues one request every five seconds for as long as it stays
  // open. Once the cap is reached nothing further is scheduled and the error is
  // left on screen with a retry control, so a permanently failing save costs at
  // most this many requests. A successful save resets the count, so an
  // intermittent failure still recovers on its own, and `retryAutoSave` resets
  // it as well so the user's explicit retry gets the same bounded cycle back.
  var MAX_CONSECUTIVE_AUTOSAVE_FAILURES = 3;

  function MaterialControl($scope, $q, $route, $routeParams, $sce, $compile, Upload, $window, $location, $timeout, $interval, $filter, markdownParser, Restangular, trinketConfig) {
    this.$scope             = $scope;
    this.$q                 = $q;
    this.$route             = $route;
    this.$routeParams       = $routeParams;
    this.$sce               = $sce;
    this.$compile           = $compile;
    this.Upload             = Upload;
    this.$window            = $window;
    this.$location          = $location;
    this.$timeout           = $timeout;
    this.$interval          = $interval;
    this.$filter            = $filter;
    this.savedMarkdown      = '';
    this.renderDelay        = 0;
    this.renderTimeout      = null;
    this.lastSavedInterval  = null;
    this.stopRenderAndSave  = false;
    this.materialSlugChange = false;
    // consecutive rejected autosaves; reset by a successful save and by an
    // explicit retry, and compared against MAX_CONSECUTIVE_AUTOSAVE_FAILURES.
    this.consecutiveSaveFailures = 0;
    this.Restangular        = Restangular;
    this.parser             = markdownParser({$scope:$scope, preview:true});
    this.beforeWindowUnload = angular.bind(this, this.beforeWindowUnload);
    this.sizeToWindow       = angular.bind(this, this.sizeToWindow);
    this.trinketConfig      = trinketConfig;

    this.defineListeners();
    this.defineScope();

    var lastRoute = $route.current;
    var self = this;
    $scope.$on('$locationChangeSuccess', function(event) {
      if (self.materialSlugChange) {
        $route.current = lastRoute;
        self.materialSlugChange = false;
      }
    });
  }

  MaterialControl.prototype.defineListeners = function() {
    var self = this;

    self.$scope.$on('$destroy', angular.bind(self, self.destroy));
    self.$scope.$on('$locationChangeStart', angular.bind(self, self.onLocationChange));

    angular.element(self.$window).bind('beforeunload', self.beforeWindowUnload);
    angular.element(self.$window).bind('resize', self.sizeToWindow);

    self.lastSavedInterval = self.$interval(function() {
      if (self.$scope.material && self.$scope.material.lastUpdated) {
        angular.element( document.querySelector('#material-last-saved') ).text( self.$filter('formatDate')(self.$scope.material.lastUpdated) );
      }
    }, 30000);
  }

  MaterialControl.prototype.defineScope = function() {
    var self   = this,
        editor  = self.$window.ace.edit('markdown'),
        session = editor.getSession();

    editor.$blockScrolling = Infinity;
    editor.setTheme('ace/theme/github');
    session.setMode('ace/mode/markdown');
    session.setUseWrapMode(true);
    if (!self.$scope.canEdit) {
      editor.setReadOnly(true);
    }

    self.editor  = editor;
    self.session = session;

    self.$scope.markdown         = '';
    self.$scope.markup           = '';
    self.$scope.uploadProgress   = 0;
    // true only once automatic retrying has stopped, which is what gates the
    // visible retry control in partials/material.html.
    self.$scope.saveRetryAvailable = false;
    self.$scope.assetsEnabled    = self.trinketConfig.get('assetsEnabled');
    self.$scope.classPageUrl     = self.trinketConfig.getClassUrl(self.$scope.userSlug, self.$scope.courseSlug);
    self.$scope.preview          = angular.bind(self, self.getPreview);
    self.$scope.updateMaterial   = angular.bind(self, self.updateMaterial);
    self.$scope.onFileSelect     = angular.bind(self, self.onFileSelect);
    self.$scope.backToCourse     = angular.bind(self, self.backToCourse);
    self.$scope.toggleDraft      = angular.bind(self, self.toggleDraft);
    self.$scope.retryAutoSave    = angular.bind(self, self.retryAutoSave);

    self.Restangular
        .one('courses', self.$scope.courseId)
        .get({outline:true,withDraft:true,with:['_owner']})
        .then(function(course) {
          self.$scope.course = course;
          angular.forEach(course.lessons, function(lesson) {
            if (lesson.slug === self.$routeParams.lessonSlug) {
              self.$scope.lesson = lesson;
              angular.forEach(lesson.materials, function(material) {
                if (material.slug === self.$routeParams.materialSlug) {
                  self.Restangular.all('courses/'+course.id+'/lessons/'+lesson.id).one('materials', material.id)
                    .get()
                    .then(function(material) {
                      self.$scope.material = material;
                      self.$scope.markdown = self.savedMarkdown = material.content || '';
                      session.setValue(self.savedMarkdown);
                      self.renderPreview();
                      session.on('change', function() {
                        self.$scope.markdown = session.getValue();
                        self.markDirty();
                      });
                    })
                    .then(function() {
                      self.$timeout(self.sizeToWindow, self.renderDelay);
                    });
                }
              });
            }
          });
        });

    // reset scroll to top of page
    self.$window.scrollTo(0, 0);
    editor.focus();
  }

  MaterialControl.prototype.destroy = function() {
    angular.element(this.$window).unbind('beforeunload', this.beforeWindowUnload);
    angular.element(this.$window).unbind('resize', this.sizeToWindow);
    //remove all listeners, all timeouts and intervals
    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
    }
    if (this.lastSavedInterval) {
      this.$interval.cancel(this.lastSavedInterval);
    }
  }

  MaterialControl.prototype.backToCourse = function() {
    var path = this.$location.path();
    var newPath = path.substring(0, path.lastIndexOf('/edit'));
    this.$location.path(newPath);
  }

  MaterialControl.prototype.onLocationChange = function(event, newUrl, oldUrl) {
    var self = this;
    // trigger a final save before we leave this page
    if (self.savedMarkdown !== self.$scope.markdown) {
      self.autoSave();
    }
  }

  MaterialControl.prototype.onFileSelect = function(files, fromModal) {
    var self = this;
    self.$scope.uploadStarted = true;
    self.$scope.uploadProgress = 0;
    for (var i = 0; i < files.length; i++) {
      self.Upload.upload({
        url:              '/file',
        method:           'POST',
        file:             files[i],
        fileFormDataName: 'upload'
      }).then(function(response) {
        var data = response.data;
        self.$scope.uploadStarted = false;
        if (fromModal) {
          $('#fileUploadModal').foundation('reveal', 'close');
        }
        self.$timeout(function(){
          var url   = '';
          var embed = data.type === 'embed' ? '!' : '';

          // use viewerjs for certain file extensions
          if (/\.(pdf|odp|odt|ods|fodt)$/.test(data.path)) {
            embed = '!';
            url   = '/components/viewerjs/index.html#../..';
          }

          // ensure that a preceding slash is present in the file path
          if (!data.path.match(/^\//)) {
            url += '/';
          }

          url += data.path;

          self.editor.insert(embed + '[' + data.name + '](' + url + ' "' + data.name + '")');
          self.editor.focus();
        });
      }, null, function(evt) {
        var progress = parseInt(100.0 * evt.loaded / evt.total);
        self.$scope.uploadProgress = progress;
      });
    }
  }

  MaterialControl.prototype.sizeToWindow = function() {
    var self          = this,
        subnavHeight  = $('.material-subnav').outerHeight(),
        toolbarHeight = $('.toolbar').outerHeight(),
        headerHeight  = $('.nav-wrapper').outerHeight(),
        height        = self.$window.innerHeight - subnavHeight - toolbarHeight - headerHeight - 1;

    $('#markdown').height(height + 'px');
    $('#preview').height(height + 'px');
    self.editor.resize();
  }

  MaterialControl.prototype.beforeWindowUnload = function() {
    var self = this;

    return self.savedMarkdown !== self.$scope.markdown
      ? 'Your work has not finished saving.'
      : undefined;
  }

  MaterialControl.prototype.toggleDraft = function() {
    var self = this;

    self.$scope.material.customPUT({isDraft:!self.$scope.material.isDraft}, 'draft')
      .then(function(result) {
        if (result && result.material) {
          angular.extend(self.$scope.material, result.material);
        }
      });
  }

  MaterialControl.prototype.updateMaterial = function(name) {
    var self     = this,
        name     = name.trim(),
        deferred = self.$q.defer();

    self.$scope.material.customPUT({name:name}, 'name')
      .then(function(result) {
        if (result && result.material) {
          angular.extend(self.$scope.material, result.material);

          // update URL path
          var currentPath = self.$location.path().split('/');
          if (currentPath[2] !== result.material.slug) {
            self.materialSlugChange = true;
            var newPath = currentPath[1] + '/' + result.material.slug + '/' + currentPath[3];
            self.$location.replace();
            self.$location.path(newPath);
          }

          return deferred.resolve(true);
        }

        if (result && result.flash && result.flash.validation) {
          return deferred.reject(result.flash.validation.name);
        }

        return deferred.reject('An unknown error occured');
      });

    return deferred.promise;
  }

  MaterialControl.prototype.getPreview = function() {
    return this.$scope.markup.length
      ? this.$sce.trustAsHtml(this.$scope.markup)
      : this.$sce.trustAsHtml('<div class="material-preview">A preview of your page will appear here.</div>');
  }

  MaterialControl.prototype.markDirty = function() {
    var self = this;

    self.$scope.dirty = true;

    // reset the auto-save timeout
    if (self.autoSaveTimeout) {
      self.$timeout.cancel(self.autoSaveTimeout);
    }
    self.autoSaveTimeout = self.$timeout(function() {
      self.autoSave();
    }, 1000);

    // resave the preview render timeout
    if (self.renderTimeout) {
      self.$timeout.cancel(self.renderTimeout);
    }

    self.renderTimeout = self.$timeout(function() {
      self.renderPreview();
    }, self.renderDelay);
  }

  MaterialControl.prototype.renderPreview = function() {
    var self = this;

    if (self.$scope.stopRenderAndSave) return;

    self.renderTimeout = false;
    var start = new Date();
    self.$scope.markup = self.parser(self.$scope.markdown);
    if(!self.$scope.$$phase) {
      self.$scope.$apply();
    }
    self.$timeout(function() {
      MathJax.Hub.Queue(["Typeset",MathJax.Hub,"preview"]);
    });
    self.renderDelay = Math.min((new Date()) - start, 5000);
  }

  MaterialControl.prototype.autoSave = function() {
    var self = this;

    if (self.$scope.stopRenderAndSave) return;
    if (self.$scope.saving) return;

    var oldContent = self.savedMarkdown;
    var newContent = self.$scope.markdown;

    if (oldContent === newContent) {
      self.$scope.dirty = false;
      return;
    }

    self.$scope.saving = true;
    self.$scope.saved  = self.$scope.saveError = false;
    self.$scope.customError = '';
    // `saveRetryAvailable` is deliberately NOT cleared here. It gates an
    // `ng-if` on the retry control, and `ng-if` destroys its element: clearing
    // it while an attempt is in flight would unmount the very button the user
    // just activated, dropping keyboard focus to <body> and forcing a tab walk
    // from the top of the document to reach the control again. Once the cap has
    // made the control visible it stays mounted until a save succeeds, and the
    // in-flight attempt is signalled by `saving` instead - see the
    // `aria-disabled` binding in public/partials/material.html.

    var patch = JsDiff.createPatch(self.$scope.material.id, oldContent, newContent);
    // remove the header
    patch = patch.substr(patch.indexOf('@'));

    self.$scope.material.customPUT({patch:patch}, 'patchContent')
      .then(function(result) {
        var resultError = false;

        if (result && result.material) {
          self.savedMarkdown = newContent;
          angular.extend(self.$scope.material, result.material);

          // the content is stored, so any earlier run of failures was
          // intermittent: start the cap's budget over
          self.consecutiveSaveFailures = 0;

          self.$timeout(function() {
            self.$scope.saving = false;
            self.$scope.saved  = true;
            // the content is stored, so there is nothing left to retry: this is
            // the one place the control is unmounted, and by then the reason it
            // existed is gone
            self.$scope.saveRetryAvailable = false;
          }, 250);
        }
        else if (result && result.status === 'error') {
          self.$timeout(function() {
            self.$scope.saving      = false;
            self.$scope.saveError   = true;
            self.$scope.customError = result.message;
          }, 250);

          resultError = true;
        }
        else {
          // just in case...
          self.$timeout(function() {
            self.$scope.saving = false;
          }, 250);
        }

        if (resultError) {
          // stop rendering and autosave attempts...
          self.$scope.stopRenderAndSave = true;
        }
        else {
          // check if the save brought the content up to date
          if (!result || !result.material || self.$scope.markdown !== newContent) {
            // not up to date so if an autosave is not yet scheduled go ahead and resave
            !self.autoSaveTimeout && self.autoSave();
          }
          else {
            // we are up to date!
            self.$scope.dirty = false;
          }
        }
      }, function(response) {
        // The rejection value is the $http response - `{data, status,
        // statusText, headers, config}` - so the outcome the user is told about
        // is the one that actually happened. It is read defensively because a
        // request that never reached the server rejects with a status of 0 or
        // -1, and an aborted request can reject with no response object at all.
        var status        = response && response.status;
        var serverMessage = response && response.data && response.data.message;
        var reachedCap    = ++self.consecutiveSaveFailures >= MAX_CONSECUTIVE_AUTOSAVE_FAILURES;

        // ensure autosaving can start back up again...
        self.$timeout(function() {
          self.$scope.saving             = false;
          self.$scope.saveError          = true;
          self.$scope.customError        = self.autoSaveErrorMessage(status, serverMessage, reachedCap);
          // latched rather than assigned: the cap is what earns the control, and
          // once earned it remains available for every subsequent failure until
          // a save succeeds, so an explicit retry that fails again does not take
          // the control away from the user who is using it
          self.$scope.saveRetryAvailable = self.$scope.saveRetryAvailable || reachedCap;
        }, 250);

        if (self.autoSaveTimeout) {
          self.$timeout.cancel(self.autoSaveTimeout);
        }

        if (reachedCap) {
          // Stop scheduling. The pending retry has just been cancelled and no
          // replacement is armed, so nothing re-enters autoSave until the user
          // edits again or activates the retry control, and the error stays on
          // screen. The cancelled promise is deliberately left assigned to
          // `self.autoSaveTimeout`: the success path above tests
          // `!self.autoSaveTimeout` to decide whether to resave immediately,
          // and clearing it here would change that unrelated decision.
          return;
        }

        // try to save again every 5 seconds...
        self.autoSaveTimeout = self.$timeout(function() {
          self.autoSave();
        }, 5000);
      });
  }

  // Builds the text the template appends to "Changes not saved.".
  //
  // "Check your network connection." is kept for the case it was written for -
  // a request that never got an HTTP status - and nothing else, because for a
  // request the server answered it is simply untrue. Everything else is
  // reported as the status it actually was, together with whatever message the
  // server sent, so the user and a support engineer are reading the same fact.
  // No diagnosis the client cannot verify is added: the client cannot tell a
  // stale-content refusal from any other server fault, because the route
  // answers both as a generic 500.
  //
  // e.g. autoSaveErrorMessage(0, undefined, false)
  //        -> 'Check your network connection.'
  //      autoSaveErrorMessage(500, 'An internal server error occurred', true)
  //        -> 'The server rejected this save (HTTP 500): An internal server
  //            error occurred. Automatic retrying has stopped.'
  MaterialControl.prototype.autoSaveErrorMessage = function(status, serverMessage, retryingStopped) {
    var message;

    if (!status || status < 0) {
      message = 'Check your network connection.';
    }
    else if (serverMessage) {
      message = 'The server rejected this save (HTTP ' + status + '): ' + serverMessage;
      if (!/[.!?]$/.test(message)) {
        message += '.';
      }
    }
    else {
      message = 'The server rejected this save (HTTP ' + status + ').';
    }

    if (retryingStopped) {
      message += ' Automatic retrying has stopped.';
    }

    return message;
  }

  // Bound onto the scope so the retry control the cap makes visible can reach
  // it. It hands the user back the cycle the cap ended: the consecutive-failure
  // budget is reset, the error is cleared, any autosave already scheduled by an
  // edit is cancelled so the click cannot double-send, and one attempt is made
  // straight away instead of after the 5000 ms timer.
  // The control stays mounted and focusable while an attempt is in flight (see
  // `autoSave`), so it can be activated again mid-attempt. Guarding on `saving`
  // is what stops that from double-sending the same patch; the template also
  // marks the control `aria-disabled` for the same window, so what assistive
  // technology reports and what this method does agree.
  MaterialControl.prototype.retryAutoSave = function() {
    var self = this;

    if (self.$scope.saving) {
      return;
    }

    self.consecutiveSaveFailures = 0;
    self.$scope.saveError        = false;
    self.$scope.customError      = '';

    if (self.autoSaveTimeout) {
      self.$timeout.cancel(self.autoSaveTimeout);
    }

    self.autoSave();
  }

  return angular
    .module('courseEditor')
    .controller('materialControl', ['$scope', '$q', '$route', '$routeParams', '$sce', '$compile', 'Upload', '$window', '$location', '$timeout', '$interval', '$filter', 'markdownParser', 'Restangular', 'trinketConfig', MaterialControl]);
})(window.angular);
