/* jshint jquery:true, browser:true */
/* global apos, AposFancyPage, aposPages, alert, _, AposWidgetEditor */

// JavaScript which enables editing of this module's content belongs here.

// We could define AposBlogPost too if we wanted it.

function AposBlog2(options) {
  var self = this;
  self.name = options.name;
  self.indexLabel = options.indexLabel;
  self.indexName = options.indexName;
  self.pieceLabel = options.pieceLabel;
  self.pieceName = options.pieceName;
  self.pluralPieceLabel = options.pluralPieceLabel;
  self._options = options;
  self._action = options.action;
  // So we can see the main AposBlog manager object
  // inside nested constructors
  var manager = self;

  // Override this method to modify the manager object
  // for the index fancy page type, for instance by
  // adding a validate method

  self.extendIndexes = function(indexes) {
  };

  // Override this method to modify the manager object
  // for the piece fancy page type, for instance by
  // adding a validate method

  self.extendPieces = function(pieces) {
  };

  // Substitute our own constructors that call our
  // extend methods

  window[getBrowserConstructor(self.indexName)] = function(options) {
    var self = this;
    AposFancyPage.call(self, options);
    apos.afterYield(function() { manager.extendIndexes(self); });
  };

  window[getBrowserConstructor(self.pieceName)] = function(options, callback) {
    var self = this;
    AposFancyPage.call(self, options);
    apos.afterYield(function() { manager.extendPieces(self); });
  };

  function getBrowserConstructor(typeName) {
    return 'Apos' + typeName.charAt(0).toUpperCase() + typeName.substr(1);
  }

  // Add jquery autocomplete of tags to the
  // tag field for aggregation, which is otherwise
  // a plain vanilla relationship string field.
  // Do this both for page settings and for the widget
  $('body').on('keydown',
    '[data-name="_andFromPages"] [data-name="tag"], ' +
    '[data-by="fromPageIds"] [data-name="tag"]', function() {
    var $tag = $(this);
    if (!$tag.data('autocomplete')) {
      $tag.data('autocomplete', true);
      $tag.autocomplete({
        source: '/apos/autocomplete-tag'
      });
    }
  });

  $('body').on('click', '[data-new-' + apos.cssName(options.pieceName) + ']', function() {
    var page = apos.data.aposPages.page;

    // Works from the blog page, and also from its subpages
    // (presumably blog posts)
    if (page.type !== self.indexName) {
      if (apos.data.aposPages.page.parent.type !== self.indexName) {
        return false;
      }
      page = apos.data.aposPages.page.parent;
    }
    // Menu item title = modal dialog title. A good workaround for
    // not having page type specific modals
    var title = $(this).text();
    var $el = aposPages.newPage(page.slug, { pageType: self.pieceName, title: title });
    return false;
  });

  $('body').on('click', '[data-delete-' + apos.cssName(options.pieceName) + ']', function() {
    var slug = apos.data.aposPages.page.slug;
    $.jsonCall(
      self._action + '/delete',
      {
        slug: slug,
        trash: '1'
      },
      function (data) {
        if (data.status === 'ok') {
          alert('Moved to the trash. View trash by selecting "Browse '+ self.pluralPieceLabel +'" from the context menu and then use the trash filter.');
          apos.redirect(data.parent);
        } else {
          alert('An error occurred. Please try again.');
        }
      }
    );
    return false;
  });

  var cssName = apos.cssName(options.pieceName);
  $('body').on('click', '[data-rescue-' + cssName + ']', function() {
    self.browseTrash();
    return false;
  });

  self.browseTrash = function() {
    var page = apos.data.aposPages.page;

    // Works from the blog page, and also from its subpages
    // (presumably blog posts)
    if (page.type !== self.indexName) {
      var page = apos.data.aposPages.page.parent;
    }

    var $el;
    var browser = {
      page: 1,
      total: 0,
      perPage: 10,
      $el: null,
      indexId: page._id,
      init: function(callback) {
        browser.$search = $el.find('[name="search"]');
        browser.$template = $el.find('[data-item]');
        browser.$template.remove();
        browser.$dataItems = $el.find('[data-items]');

        $el.on('keyup', '[name="search"]', function(e) {
          if (e.keyCode === 13) {
            $el.find('[data-search-submit]').trigger('click');
            return false;
          }
        });

        $el.on('click', '[data-search-submit]', function(e) {
          browser.page = 1;
          browser.load();
          return false;
        });

        $el.on('click', '[data-remove-search]', function() {
          browser.page = 1;
          browser.$search.val('');
          browser.load();
          return false;
        });

        $el.on('click', '[data-item]', function() {
          browser.rescue($(this).attr('data-slug'));
          return false;
        });

        $el.on('click', '[data-page]', function() {
          browser.page = $(this).attr('data-page');
          browser.load();
          return false;
        });

        return browser.load(callback);
      },
      load: function(callback) {
        $.getJSON(
          self._action + '/get',
          {
            trash: true,
            search: browser.$search.val(),
            skip: (browser.page - 1) * browser.perPage,
            limit: browser.perPage,
            fromPageIds: [browser.indexId],
            publishedAt: 'any'
          },
          function(data) {
            if (data.status !== 'ok') {
              alert('An error occurred. Please try again.');
              return callback && callback('error');
            }
            browser.$dataItems.find('[data-item]:not(.apos-template)').remove();
            _.each(data.pages, function(result) {
              var $item = apos.fromTemplate(browser.$template);
              $item.find('[data-title]').text(result.title);
              // Show just the date part of the timestamp
              $item.find('[data-date]').text(result.publicationDate);
              $item.attr('data-slug', result.slug);
              browser.$dataItems.append($item);
            });
            browser.total = Math.ceil(data.total / browser.perPage);
            if (browser.total < 1) {
              browser.total = 1;
            }
            browser.pager();
            return callback && callback(null);
          }
        );
      },
      pager: function() {
        // Rebuild pager based on 'page' and 'total'
        $.get('/apos/pager', { page: browser.page, total: browser.total }, function(data) {
          $el.find('[data-pager-box]').html(data);
        });
      },
      rescue: function(slug) {
        $.jsonCall(
          self._action + '/delete',
          {
            slug: slug,
            trash: false
          },
          function (data) {
            if (data.status === 'ok') {
              alert('Restored as an unpublished draft.');
              apos.redirect(data.slug);
            } else {
              alert('An error occurred. Please try again.');
            }
          }
        );
      }
    };

    // A hook to extend the trash browser
    self.extendBrowseTrash(browser);
    $el = apos.modalFromTemplate('.apos-browse-trash-' + cssName, browser);
    browser.$el = $el;
  };

  // Receives the "browser" object defined above. Called before
  // the modal is initialized so you can override or extend the
  // methods
  self.extendBrowseTrash = function(browser) {
  };


  $('body').on('click', '[data-browse-' + apos.cssName(self.indexName) + ']', function() {
    self.browsePieces();
    return false;
  });

  /* BROWSE ALL PIECES */
  self.browsePieces = function() {
    var page = apos.data.aposPages.page;

    // Works from the blog page, and also from its subpages
    // (presumably blog posts)
    if (page.type !== self.indexName) {
      var page = apos.data.aposPages.page.parent;
    }

    var $el;
    var browser = {
      page: 1,
      total: 0,
      perPage: 10,
      filters: {
        trash: '0',
        published: 'any',
      },
      indexId: page._id,
      $el: null,
      init: function(callback) {
        browser.$search = $el.find('[name="search"]');
        browser.$template = $el.find('[data-item]');
        browser.$template.remove();
        browser.$dataItems = $el.find('[data-items]');

        //reset filters
        $el.find('[data-pill] [data-choice]').removeClass('apos-active');
        _.each(browser.filters, function(value, filter) {
          $el.find('[data-pill][data-name="' + filter + '"] [data-choice="' + value + '"]').addClass('apos-active');
        });

        $el.on('keyup', '[name="search"]', function(e) {
          if (e.keyCode === 13) {
            $el.find('[data-search-submit]').trigger('click');
            return false;
          }
        });

        $el.on('click', '[data-search-submit]', function(e) {
          browser.page = 1;
          browser.load();
          return false;
        });

        $el.on('click', '[data-remove-search]', function() {
          browser.page = 1;
          browser.$search.val('');
          browser.load();
          return false;
        });

        // filters
        $el.on('click', '[data-pill] [data-choice]', function() {
          var $choice = $(this);
          var $pill = $choice.closest('[data-pill]');
          $pill.find('[data-choice]').removeClass('apos-active');
          $choice.addClass('apos-active');
          browser.filters[$pill.data('name')] = $choice.attr('data-choice');
          browser.page = 1;
          browser.load();
          return false;
        });

        $el.on('click', '[data-item]', function() {
          if ($(this).attr('data-trash')) {
            if (confirm('Bring this item back from the trash?')) {
              $.jsonCall(
                self._action + '/delete',
                {
                  slug: $(this).attr('data-slug'),
                  trash: false
                },
                function (data) {
                  if (data.status === 'ok') {
                    alert('Restored as an unpublished draft.');
                    apos.change(self.name);
                    browser.load();
                  } else {
                    alert('An error occurred. Please try again.');
                  }
                }
              );
            }
          } else {
            apos.redirect($(this).attr('data-slug'));
          }
          return false;
        });

        $el.on('click', '[data-page]', function() {
          browser.page = $(this).attr('data-page');
          browser.load();
          return false;
        });

        return browser.load(callback);
      },
      load: function(callback) {
        $.getJSON(
          self._action + '/get',
          {
            search: browser.$search.val(),
            skip: (browser.page - 1) * browser.perPage,
            limit: browser.perPage,
            trash: browser.filters.trash,
            published: browser.filters.published,
            publishedAt: 'any',
            fromPageIds: [browser.indexId]
          },
          function(data) {
            if (data.status !== 'ok') {
              alert('An error occurred. Please try again.');
              return callback && callback('error');
            }
            browser.$dataItems.find('[data-item]:not(.apos-template)').remove();
            browser.populateItems(data.pages);
            browser.total = Math.ceil(data.total / browser.perPage);
            if (browser.total < 1) {
              browser.total = 1;
            }
            browser.pager();
            return callback && callback(null);
          }
        );
      },
      populateItems: function(items) {
        _.each(items, function(result) {
          var $item = apos.fromTemplate(browser.$template);
          $item.find('[data-title]').text(result.title);
          // Show just the date part of the timestamp
          $item.find('[data-date]').text(result.publicationDate);
          $item.attr('data-slug', result.slug);
          if (result.trash) {
            $item.attr('data-trash', 1);
          }
          browser.$dataItems.append($item);
        });
      },
      pager: function() {
        // Rebuild pager based on 'page' and 'total'
        $.get('/apos/pager', { page: browser.page, total: browser.total }, function(data) {
          $el.find('[data-pager-box]').html(data);
        });
      }
    };

    // A hook to extend the piece browser
    self.extendBrowsePieces(browser);
    $el = apos.modalFromTemplate('.apos-browse-pieces-' + cssName, browser);
    browser.$el = $el;
  }

  /* NOTE: To change the browser fields, simply override this function
     and change the populateItems method on browser, which takes items as an arg */ 
  self.extendBrowsePieces = function(browser) {
  }

  if (options.widget) {

    var widgetName = manager._options.widget.name || manager.indexName;
    apos.widgetTypes[widgetName] = {
      // For the rich content editor's menu
      label: manager._options.widget.label || manager.indexLabel,

      // Constructor for widget editor
      editor: function(options) {
        var self = this;
        self.manager = manager;
        self._action = manager._action;
        self.defaultLimit = options.options.limit || options.limit || manager._options.widget.defaultLimit || 5;

        self.type = widgetName;
        self.css = apos.cssName(self.type);
        options.template = '.apos-' + self.css + '-widget-editor';

        if (!options.messages) {
          options.messages = {};
        }
        if (!options.messages.missing) {
          options.messages.missing = 'Pick at least one.';
        }

        self.afterCreatingEl = function() {
          if (self.data.limitByTag === undefined) {
            self.data.limitByTag = self.defaultLimit;
          }
          if (self.data.limitFromPageIds === undefined) {
            self.data.limitFromPageIds = self.defaultLimit;
          }
          self.$by = self.$el.findByName('by');

          if (options.options.sources) {
            var sources = options.options.sources;
            // The developer used the sources option to limit where
            // things can come from, and/or re-order the three choices
            var choices = {};
            choices.title = self.$by.find('[value="id"]');
            choices.tag = self.$by.find('[value="tag"]');
            choices.page = self.$by.find('[value="fromPageIds"]');
            choices.title.remove();
            choices.tag.remove();
            choices.page.remove();
            _.each(sources, function(source) {
              self.$by.append(choices[source]);
            });
            if (self.$by.find('[value]').length == 1) {
              // Don't display a dropdown with only one choice.
              // Keep it around to act as a hidden element
              self.$el.find('[data-sources]').hide();
            }
          }
          self.$by.val(self.data.by || self.$by.find('[value]:first').attr('value'));

          self.$tags = self.$el.findSafe('[data-name="tags"]', '[data-by="fromPageIds"]');
          apos.enableTags(self.$tags, self.data.tags);
          self.$limitByTag = self.$el.findByName('limitByTag');
          self.$limitByTag.val(self.data.limitByTag);
          self.$limitFromPageIds = self.$el.findByName('limitFromPageIds');
          self.$limitFromPageIds.val(self.data.limitFromPageIds);

          self.pending = 0;

          // Set up jquery selective to autocomplete the titles
          // of pieces (e.g. blog posts). We start with an autocomplete
          // request to get the titles of the pieces whose IDs we already
          // selected in the past. Then we set up selective with
          // a source function that can autocomplete more pieces
          // of the appropriate type.

          self.$ids = self.$el.find('[data-name="ids"]');

          // To avoid a race condition we keep track of outstanding
          // AJAX requests and don't allow prePreview or preSave to
          // complete until those are all taken care of.

          self.pending++;

          self.$ids.selective({
            data: self.data.ids || [],
            source: function(_r, callback) {
              var r = _.cloneDeep(_r);
              r.type = manager.pieceName;
              $.jsonCall('/apos-pages/autocomplete', r, callback);
            },
            sortable: true,
            limit: options.options.limit,
            afterSet: function() {
              self.completedTask();
            }
          });

          // Set up jquery selective to autocomplete the titles
          // of indexes (e.g. entire blogs).

          self.$fromPageIds = self.$el.find('[data-name="fromPageIds"]');

          self.pending++;

          // Implement custom relationship field types (tags)
          self.$fromPageIds.on('afterAddItem', function(e, item, $item) {
            var $tags = $item.findSafe('[data-name="tags"]', '[data-selective]');
            apos.enableTags($tags, item.tags || []);
          });

          self.$fromPageIds.on('afterGetItem', function(e, item, $item) {
            var $tags = $item.findSafe('[data-name="tags"]', '[data-selective]');
            item.tags = $tags.selective('get');
          });

          self.$fromPageIds.selective({
            data: self.data.fromPageIds || [],
            extras: true,
            source: function(_r, callback) {
              var r = _.cloneDeep(_r);
              r.type = manager.indexName;
              $.jsonCall('/apos-pages/autocomplete', r, callback);
            },
            sortable: false,
            nestGuard: '[data-selective]',
            afterSet: function() {
              self.completedTask();
            }
          });

          self.$by.on('change', function() {
            var val = $(this).val();
            self.$el.find('[data-by]').removeClass('apos-active');
            var $activeFieldset = self.$el.find('[data-by="' + val + '"]');
            $activeFieldset.addClass('apos-active');
            // Ready to type something
            $activeFieldset.find('input[type="text"]:first').focus();
            return false;
          });

          // Send a change event to enable the currently chosen type
          // after jquery selective initializes
          apos.afterYield(function() {
            self.$by.trigger('change');
          });
        };

        self.completedTask = function() {
          self.pending--;
          if (!self.pending) {
            if (self.pendingCallback) {
              var pc = self.pendingCallback;
              self.pendingCallback = undefined;
              return pc();
            }
          }
        };

        // Parent class constructor shared by all widget editors
        AposWidgetEditor.call(self, options);

        self.debrief = function(callback) {
          self.data.by = self.$by.val();
          self.data.tags = self.$tags.selective('get', { incomplete: true });
          self.data.limitByTag = parseInt(self.$limitByTag.val(), 10);
          self.data.limitFromPageIds = parseInt(self.$limitFromPageIds.val(), 10);
          if (self.pending) {
            self.pendingCallback = whenReady;
            return;
          } else {
            return whenReady();
          }
          function whenReady() {
            self.data.ids = self.$ids.selective('get', { incomplete: true });
            self.data.fromPageIds = self.$fromPageIds.selective('get', { incomplete: true });
            // Don't force them to pick something, it's common to want to
            // go back to an empty singleton
            self.exists = true;
            return callback();
          }
        };

        self.prePreview = self.debrief;
        self.preSave = self.debrief;

        // Give the manager a chance to extend the widget.
        // Do it on next tick so there is an opportunity to
        // override
        return apos.afterYield(function() {
          manager.extendWidget(self);
        });
      }
    };
    // Your chance to extend a widget editor object when subclassing
    self.extendWidget = function(widget) {
    };
  }
}

// When we explicitly subclass the blog, there must also be a subclass
// on the browser side. However sometimes this subclass really has no
// unique work to do, so we can synthesize it automatically.

AposBlog2.subclassIfNeeded = function(constructorName, baseConstructorName, options) {
  if (!window[constructorName]) {
    window[constructorName] = function(options) {
      var self = this;
      window[baseConstructorName].call(self, options);
    };
  }
};
