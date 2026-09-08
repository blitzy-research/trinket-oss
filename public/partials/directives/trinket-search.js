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
      scope.searchLabelId      = scope.searchLabelId || "search-label";

      // `inputId` is deliberately NOT defaulted. Both library views put
      // `data-magellan-expedition="fixed"` on `.library-subnav`, and Foundation Magellan clones
      // the whole expedition when it goes fixed (foundation.magellan.js:114-121:
      // `expedition.clone()` inserted *before* the original), duplicating every id inside it -
      // measured on /library/trinkets, where scrolling to y=700 took the counts of
      // `#trinket-search` and `#search-label` from 1 to 2 and produced Chrome's "Duplicate form
      // field id in the same form" issue. The clone copies whatever id is present, so a
      // per-instance unique id would not help; the input carries an id only when a consumer asks
      // for one (`input-id`, used by the never-cloned assignment-editor modal). The template uses
      // `ng-attr-id`, whose allOrNothing interpolation omits the attribute entirely rather than
      // rendering `id=""` when this is undefined.
      //
      // `searchLabelId` keeps its default: `#search-label` is styled (static/scss/_library.scss)
      // and read by the course-editor toolbar controller, and it is not a form field.

      // Accessible name for the icon-only toggle button (template `aria-label`). The button's
      // only content is a pseudo-element glyph, so without this its name is a private-use
      // codepoint. Every consumer passes `placeholder-text`, which already describes the search
      // in that context ("search by name or instructions", "add trinkets by name or
      // instructions"), so it is the most accurate name available and needs no consumer change;
      // `search-label-text` overrides it, and the literal is the fallback for a consumer that
      // passes neither.
      scope.searchLabelText    = scope.searchLabelText || scope.placeholderText || "Search trinkets";

      // The directive's own search field and toggle control, resolved by traversing this
      // directive's element rather than by document id. The template renders exactly one
      // `.search-input input`, and exactly one BUTTON or A toggle control (none when `no-label`
      // is set), so both resolve uniquely - and neither lookup can reach a Magellan clone of the
      // subnav, which a document-wide `getElementById` would, because the clone is inserted
      // before the original and would win.
      function searchField() {
        return element[0].querySelector('.search-input input');
      }

      function toggleControl() {
        var children = element[0].children;

        for (var i = 0; i < children.length; i++) {
          if (children[i].tagName === 'BUTTON' || children[i].tagName === 'A') {
            return children[i];
          }
        }

        return null;
      }

      scope.toggleSearchInput = function() {
        scope.searchInputOpen = !scope.searchInputOpen;

        if (scope.searchInputOpen) {
          var field = searchField();

          if (field) {
            field.focus();
          }
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

      // Close the search on any click that is not on this directive's own toggle control or
      // search field. The test is node identity against those two elements instead of a
      // comparison of `event.target.id` against `searchLabelId`/`inputId`: the field no longer
      // carries an id by default, and an id comparison with an undefined id would keep every
      // id-less click - i.e. nearly all of them - from closing the search. `contains` covers the
      // icon inside the toggle control, which is what the previous `.parent().attr('id')` reached.
      angular.element($document).on('click', function(event) {
        var toggle   = toggleControl()
          , field    = searchField()
          , target   = event.target
          , onToggle = !!toggle && (toggle === target || toggle.contains(target))
          , onField  = !!field && field === target;

        if (!onToggle && !onField) {
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
          , searchLabelText : '@'
          , noLabel         : '='
        }
    };
  }]);

})(window.angular);
