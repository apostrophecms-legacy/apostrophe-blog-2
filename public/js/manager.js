// JavaScript which enables editing of this module's content belongs here.

// We could define AposBlogPost too if we wanted it.

function AposBlog2(options) {
  var self = this;
  self.name = options.name;
  self.indexLabel = options.indexLabel;
  self.indexName = options.indexName;
  self.pieceLabel = options.pieceLabel;
  self.pieceName = options.pieceName;
  self._options = options;
  self._action = options.action;

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
        trash: true
      },
      function (data) {
        if (data.status === 'ok') {
          alert('Moved to the trash. Select "Browse Trash" from the context menu to recover items from the trash.');
          window.location.href = aposPages.options.root + data.parent;
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

    var $el;
    var browser = {
      page: 1,
      total: 0,
      perPage: 10,
      $el: null,
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
            limit: browser.perPage
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
              window.location.href = aposPages.options.root + data.slug;
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

  if (options.widget) {

    // So we can see the main AposBlog manager object
    // inside the widget editor's constructor
    var manager = self;

    var widgetName = manager._options.widget.name || manager.indexName;
    apos.widgetTypes[widgetName] = {
      // For the rich content editor's menu
      label: manager._options.widget.label || manager.indexLabel,

      // Constructor for widget editor
      editor: function(options) {
        var self = this;
        self.manager = manager;
        self._action = manager._action;
        self.defaultLimit = options.limit || manager._options.widget.defaultLimit || 5;

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
          self.$by.radio(self.data.by);
          self.$tags = self.$el.find('[data-name="tags"]');
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

          $.jsonCall('/apos-pages/autocomplete', { values: self.data.ids || [], type: manager.pieceName }, function(data) {
            self.$ids.selective({
              data: data,
              source: function(_r, callback) {
                var r = _.cloneDeep(_r);
                r.type = manager.pieceName;
                $.jsonCall('/apos-pages/autocomplete', r, callback);
              },
              sortable: true,
              limit: options.options.limit
            });

            self.completedTask();
          });

          // Set up jquery selective to autocomplete the titles
          // of indexes (e.g. entire blogs).

          self.$fromPageIds = self.$el.find('[data-name="fromPageIds"]');

          self.pending++;

          $.jsonCall('/apos-pages/autocomplete', { values: self.data.fromPageIds || [], type: manager.indexName }, function(data) {
            self.$fromPageIds.selective({
              data: data,
              source: function(_r, callback) {
                var r = _.cloneDeep(_r);
                r.type = manager.indexName;
                $.jsonCall('/apos-pages/autocomplete', r, callback);
              },
              sortable: false
            });

            self.completedTask();
          });

          // Any click inside one of the fieldsets should switch to it
          self.$el.on('click', 'fieldset', function() {
            var $switcher = $(this).find('[data-switcher]');
            $switcher.trigger('click');
            return true;
          });

          // Radio button click events should switch the apos-active class
          self.$el.on('click', '[data-switcher]', function(e) {
            var val = $(this).attr('value');
            self.$el.find('[data-by]').removeClass('apos-active');
            var $activeFieldset = self.$el.find('[data-by="' + val + '"]');
            $activeFieldset.addClass('apos-active');
            // Ready to type something
            $activeFieldset.find('input[type="text"]:first').focus();
            // Don't prevent default browser behavior, just stop bubbling
            e.stopPropagation();
          });

          // Trigger the default fieldset's radio button to initialize
          // apos-active. Do it after jquery selective has a chance
          // to initialize so that the focus stuff works
          apos.afterYield(function() {
            self.$el.find('[data-switcher][value="' + (self.data.by || 'id') + '"]').trigger('click');
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
          self.data.by = self.$by.radio();
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
