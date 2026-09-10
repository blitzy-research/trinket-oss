(function(angular) {
  'use strict';

  angular.module('trinket.search', ['trinket.components.trinkets'])
  .directive('trinketSearch', ['$document', 'trinketsApi', function($document, trinketsApi) {
    function link(scope, element) {
      scope.searchInputOpen    = scope.searchInputOpen || false;
      scope.searchInputActive  = false;
      scope.trinketSearchValue = "";
      scope.navbar             = true;
      scope.buttonIcon         = scope.buttonIcon    || "fa fa-search fa-fw";
      scope.inputId            = scope.inputId       || "trinket-search";
      scope.searchLabelId      = scope.searchLabelId || "search-label";

      scope.toggleSearchInput = function() {
        scope.searchInputOpen = !scope.searchInputOpen;

        if (scope.searchInputOpen) {
          element[0].querySelector('#' + scope.inputId).focus();
        }
        else {
          scope.searchInputActive = false;
        }
      }

      scope.searchTrinkets = function(val) {
        scope.loadingTrinkets   = true;
        scope.searchInputActive = true;

        return trinketsApi.search(val).then(function(results) {
          var trinkets = [];
          scope.loadingTrinkets = false;

          angular.forEach(results, function(trinket) {
            if (!trinket.name) {
              trinket.name = 'Untitled';
            }
            trinkets.push(trinket);
          });

          return trinkets;
        });
      }

      scope.onSelectResult = function(item) {
        scope.trinketSearchValue = "";
        scope.onSelect(item);
      }

      angular.element($document).on('click', function(event) {
        var targetId = event.target.id || $(event.target).parent().attr('id');

        if (targetId !== scope.searchLabelId && targetId !== scope.inputId) {
          scope.searchInputOpen   = false;
          scope.searchInputActive = false;
          scope.$apply();
        }
      });
    }

    return {
        restrict    : 'E'
      , templateUrl : '/partials/directives/trinket-search.html'
      , link        : link
      , scope       : {
            placeholderText : '@'
          , onSelect        : '='
          , toolbar         : '='
          , buttonIcon      : '@'
          , searchInputOpen : '=?'
          , inputId         : '@'
          , searchLabelId   : '@'
          , noLabel         : '='
        }
    };
  }]);

})(window.angular);
