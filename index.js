var async = require('async');
var _ = require('lodash');
var fancyPage = require('apostrophe-fancy-page');
var RSS = require('rss');
var url = require('url');
var absolution = require('absolution');
var moment = require('moment');
var util = require('util');

module.exports = blog2;

function blog2(options, callback) {
  return new blog2.Blog2(options, callback);
}

blog2.Blog2 = function(options, callback) {
  var self = this;

  options.modules = (options.modules || []).concat([ { dir: __dirname, name: 'blog-2' } ]);

  self.name = options.name || 'Blog2';
  self._apos = options.apos;
  self._action = '/apos-' + self._apos.cssName(self.name);
  self._app = options.app;
  self._pages = options.pages;
  self._schemas = options.schemas;
  self._options = options;
  self._perPage = options.perPage || 10;
  self._dateInSlug = (options.dateInSlug === undefined) ? true : options.dateInSlug;
  self.pieceName = options.pieceName || 'blogPost';
  self.pieceLabel = options.pieceLabel || 'Blog Post';
  self.pluralPieceLabel = options.pluralPieceLabel || self.pieceLabel + 's';
  self.indexName = options.indexName || 'blog';
  self.indexLabel = options.indexLabel || 'Blog';
  self.pluralIndexLabel = options.pluralIndexLabel || self.indexLabel + 's';

  self._browser = options.browser || {};

  // Mix in the ability to serve assets and templates
  self._apos.mixinModuleAssets(self, 'blog-2', __dirname, options);

  // Set defaults for feeds, but respect it if self._options.feed has been
  // explicitly set false
  if (self._options.feed === undefined) {
    self._options.feed = {};
  }
  if (self._options.feed) {
    var defaultPrefix;
    // Let apostrophe-site clue us in to the name of the site so our feed title
    // is not as bare as "Blog" or "Calendar"
    if (self._options.site && self._options.site.title) {
      // endash
      defaultPrefix = self._options.site.title + (self._options.feed.titleSeparator || ' – ');
    } else {
      defaultPrefix = '';
    }
    _.defaults(self._options.feed, {
      // Show the thumbnail singleton if available
      thumbnail: true,
      // If the thumbnail is not available and the body contains an image,
      // show that instead
      alternateThumbnail: true,
      titlePrefix: defaultPrefix
    });
  }

  self.setupIndexes = function() {
    self.indexes = {};

    var indexesOptions = options.indexes || {};
    self.indexes.options = indexesOptions;

    _.defaults(indexesOptions, {
      name: self.indexName,
      label: self.indexLabel,
      pluralLabel: self.pluralIndexLabel,
      apos: options.apos,
      app: options.app,
      pages: options.pages,
      schemas: options.schemas,
      modules: options.modules,
      // Greedy so we can add year and month to the URL
      greedy: true,
      browser: {
        baseConstruct: 'AposFancyPage',
        options: {}
      },
      pageSettingsTemplate: 'indexPageSettings',
      // So far manager.js seems sufficient, but we could
      // use these options to provide separate files for
      // each of these components within the blog-2 module
      // editorScript: 'indexEditor',
      // contentScript: 'indexContent'
    });
    indexesOptions.addFields = [
      {
        name: '_andFromPages',
        label: 'And From These Blogs',
        type: 'joinByArray',
        idsField: 'andFromPagesIds',
        relationship: [
          {
            name: 'tag',
            label: 'With this tag (optional)',
            type: 'string',
          }
        ],
        relationshipsField: 'andFromPagesRelationships',
        withType: 'blog'
      }
    ].concat(indexesOptions.addFields || []);

    _.defaults(indexesOptions, {
      // Rebuild the context menu, renaming items and
      // throwing in a new one
      contextMenu: [
        {
          name: 'new-' + self._apos.cssName(self.pieceName),
          label: 'New ' + self.pieceLabel
        },
      ].concat(options.allowSubpagesOfIndex ?
        [
          {
            name: 'new-page',
            label: 'New Page'
          }
        ] :
        []
      ).concat([
        {
          name: 'edit-page',
          label: self.indexLabel + ' Settings'
        },
        {
          name: 'versions-page',
          label: 'Page Versions'
        },
        {
          name: 'rescue-' + self._apos.cssName(self.pieceName),
          label: 'Browse Trash'
        },
        {
          name: 'delete-page',
          label: 'Move Entire ' + self.indexLabel + ' to Trash'
        }
        // the reorg menu used to be added here but is now added
        // in the pages module only in the case of `req.permissions.admin = true`
      ])
    });
    fancyPage.FancyPage.call(self.indexes, indexesOptions, null);

    // When an index page is visited, fetch the pieces and
    // call self.index to render it
    self.indexes.dispatch = function(req, callback) {
      var criteria = {};
      var options = {};
      var results;
      self.addPager(req, options);
      self.addCriteria(req, criteria, options);
      return async.series({
        get: function(callback) {
          return self.pieces.get(req, criteria, options, function(err, _results) {
            if (err) {
              return callback(err);
            }
            results = _results;

            return callback(null);
          });
        },
        tags: function(callback) {
          if (self.pieces.options.tags === false) {
            return setImmediate(callback);
          }
          var distinctOptions = _.cloneDeep(options);
          distinctOptions.getDistinct = 'tags';
          return self.pieces.get(req, criteria, distinctOptions, function(err, tags) {
            if (err) {
              return callback(err);
            }
            // These weren't being passed to the template.
            // Now they're stuffed in piecesTags. Arguably,
            // the name should derive from piecesPlural. - Joel
            req.extras.piecesTags = tags;
            return callback(null);
          });
        }
      }, function(err) {
        if (err) {
          return callback(err);
        }
        self.setPagerTotal(req, results.total);
        return self.index(req, results.pages, callback);
      });
    };
  };

  // Sets up req.extras.pager and adds skip and limit to the criteria.
  // YOU MUST ALSO CALL setPagerTotal after the total number of items available
  // is known (results.total in the get callback). Also sets an appropriate
  // limit if an RSS feed is to be generated.

  self.addPager = function(req, options) {
    var pageNumber = self._apos.sanitizeInteger(req.query.page, 1, 1);
    req.extras.pager = {
      page: pageNumber
    };
    if (req.query.feed) {
      // RSS feeds are not paginated and generally shouldn't contain more than
      // 50 entries because many feedreaders will reject overly large feeds,
      // but provide an option to override this. Leave req.extras.pager in place
      // to avoid unduly upsetting code that primarily deals with pages
      options.skip = 0;
      options.limit = self._options.feed.limit || 50;
      return;
    }
    options.skip = self._perPage * (pageNumber - 1);
    options.limit = self._perPage;
  };

  self.setPagerTotal = function(req, total) {
    req.extras.pager.total = Math.ceil(total / self._perPage);
    if (req.extras.pager.total < 1) {
      req.extras.pager.total = 1;
    }
  };

  // Called to decide what the index template name is.
  // "index" is the default. If the request is an AJAX request, we assume
  // infinite scroll and render "indexAjax". If req.query.feed is present, we render an RSS feed
  self.setIndexTemplate = function(req) {
    if (req.query.feed && self._options.feed) {
      // No layout wrapped around our RSS please
      req.decorate = false;
      req.contentType = self.feedContentType(req.query.feed);
      req.template = self.renderFeed;
    } else {
      if ((req.xhr || req.query.xhr) && (!req.query.apos_refresh)) {
        req.template = self.renderer('indexAjax');
      } else {
        req.template = self.renderer('index');
      }
    }
  };

  // The standard implementation of an 'index' page template for many pieces, for your
  // overriding convenience
  self.index = function(req, pieces, callback) {
    // The infinite scroll plugin is expecting a 404 if it requests
    // a page beyond the last one. Without it we keep trying to load
    // more stuff forever
    if (req.xhr && (req.query.page > 1) && (!pieces.length)) {
      req.notfound = true;
      return callback(null);
    }
    self.setIndexTemplate(req);
    // Generic noun so we can more easily inherit templates
    req.extras.pieces = pieces;
    return self.beforeIndex(req, pieces, callback);
  };

  // For easier subclassing, these callbacks are invoked at the last
  // minute before the template is rendered. You may use them to extend
  // the data available in req.extras, etc. To completely override
  // the "index" behavior, override self.index or self.dispatch.
  self.beforeIndex = function(req, pieces, callback) {
    return callback(null);
  };

  // Given the value of the "feed" query parameter, return the appropriate
  // content type. Right now feed is always rss and the return value is always
  // application/rss+xml, but you can override to handle more types of feeds
  self.feedContentType = function(feed) {
    return 'application/rss+xml';
  };

  // Render a feed as a string, using the same data that we'd otherwise pass
  // to the index template, notably data.pieces. req.query.feed specifies the
  // type of feed, currently we assume RSS
  self.renderFeed = function(data, req) {
    // Lots of information we don't normally have in a page renderer.
    var feedOptions = {
      title: self._options.feed.title || ((self._options.feed.titlePrefix || '') + data.page.title),
      description: self._options.feed.description,
      generator: self._options.feed.generator || 'Apostrophe 2',
      feed_url: req.absoluteUrl,
      // Strip the ?feed=rss back off, in a way that works if there are other query parameters too
      site_url: self._apos.build(req.absoluteUrl, { feed: null }),
      image_url: self._options.feed.imageUrl
    };
    _.defaults(feedOptions, {
      description: feedOptions.title
    });
    var feed = new RSS(feedOptions);
    _.each(data.pieces, function(piece) {
      feed.item(self.renderFeedPiece(piece, req));
    });
    return feed.xml('  ');
  };

  // Returns an object ready to be passed to the .item method of the rss module
  self.renderFeedPiece = function(piece, req) {
    var feedPiece = {
      title: piece.title,
      description: self.renderFeedPieceDescription(piece, req),
      // Make it absolute
      url: url.resolve(req.absoluteUrl, piece.url),
      guid: piece._id,
      author: piece.author || piece._author || undefined,
      // A bit of laziness that covers derivatives of our blog, our events,
      // and everything else
      date: piece.publishedAt || piece.start || piece.createdAt
    };
    return feedPiece;
  };

  /**
   * Given an piece and a req object, should return HTML suitable for use in an RSS
   * feed to represent the body of the piece. Note that any URLs must be absolute.
   * Hint: req.absoluteUrl is useful to resolve relative URLs. Also the
   * absolution module.
   * @param  {Object} piece The snippet in question
   * @param  {Object} req  Express request object
   * @return {String}      HTML representation of the body of the piece
   */
  self.renderFeedPieceDescription = function(piece, req) {
    // Render a partial for this individual feed piece. This lets us use
    // aposArea and aposSingleton normally etc.
    var result = self.renderer('feedPiece')({
      page: req.page,
      piece: piece,
      url: req.absoluteUrl,
      options: self._options.feed
    });
    // We have to resolve all the relative URLs that might be kicking around
    // in the output to generate valid HTML for use in RSS
    result = absolution(result, req.absoluteUrl).trim();
    return result;
  };

  // This method extends the mongodb criteria used to fetch pieces
  // based on query parameters and general rules that should be applied
  // to the normal view of content.

  self.addCriteria = function(req, criteria, options) {
    if (req.query.tag) {
      options.tags = [ self._apos.sanitizeString(req.query.tag) ];
    }

    self.addDateCriteria(req, criteria, options);

    options.fromPages = [ req.page ];

    if (req.query.search) {
      options.search = self._apos.sanitizeString(req.query.search);
    }

    // Admins have to be able to see unpublished content because they have to get
    // to it to edit it and there is no "manage" dialog needed anymore
    // criteria.published = true;
  };

  // Extract year and month from the URL if present, add
  // them to criteria as needed, set up thisYear and thisMonth

  self.addDateCriteria = function(req, criteria, options) {
    if (req.remainder.length) {
      // Spot a year and month in the URL to implement filtering by month
      matches = req.remainder.match(/^\/(\d+)\/(\d+)$/);

      // activeYear and activeMonth = we are filtering to that month.
      // thisYear and thisMonth = now (as in today).

      // TODO: consider whether blog and events should share more logic
      // around this and if so whether to use a mixin module or shove it
      // into the (dangerously big already) base class, the snippets module
      // or possibly even have events subclass blog after all.

      if (matches) {
        // force to integer
        req.extras.activeYear = matches[1];
        req.extras.activeMonth = matches[2];
        // set up the next and previous urls for our calendar
        var nextYear = req.extras.activeYear;
        // Note use of - 0 to force a number
        var nextMonth = req.extras.activeMonth - 0 + 1;
        if (nextMonth > 12) {
          nextMonth = 1;
          nextYear = req.extras.activeYear - 0 + 1;
        }
        nextMonth = pad(nextMonth, 2);
        req.extras.nextYear = nextYear;
        req.extras.nextMonth = nextMonth;

        var prevYear = req.extras.activeYear;
        var prevMonth = req.extras.activeMonth - 0 - 1;
        if (prevMonth < 1) {
          prevMonth = 12;
          prevYear = req.extras.activeYear - 0 - 1;
        }
        prevMonth = pad(prevMonth, 2);
        req.extras.prevYear = prevYear;
        req.extras.prevMonth = prevMonth;
        // Make sure the default dispatcher considers the job done
        req.remainder = '';
      }
    } else {
      // Nothing extra in the URL
      req.extras.defaultView = true;
      // The current month and year, for switching to navigating by month
      var now = moment(new Date());
      req.extras.thisYear = now.format('YYYY');
      req.extras.thisMonth = now.format('MM');
    }
    if (req.extras.activeYear) {
      // force to integer
      var year = req.extras.activeYear - 0;
      // month is 0-11 because javascript is wacky because Unix is wacky
      var month = req.extras.activeMonth - 1;
      // this still works if the month is already 11, you can roll over
      criteria.publishedAt = { $gte: new Date(year, month, 1), $lt: new Date(year, month + 1, 1) };
      // When showing content by month we switch to ascending dates
      options.sort = { publishedAt: 1 };
    }
    function pad(s, n) {
      return self._apos.padInteger(s, n);
    }
  };

  // For easier subclassing, these callbacks are invoked at the last
  // minute before the template is rendered. You may use them to extend
  // the data available in req.extras, etc. To completely override
  // the "show" behavior, override self.show or self.dispatch.
  self.beforeShow = function(req, page, callback) {
    return callback(null);
  };

  self.setupPieces = function() {
    self.pieces = {};

    var piecesOptions = options.pieces || {};
    self.pieces.options = piecesOptions;

    _.defaults(piecesOptions, {
      name: self.pieceName,
      label: self.pieceLabel,
      pluralLabel: self.pluralPieceLabel,
      apos: options.apos,
      app: options.app,
      pages: options.pages,
      schemas: options.schemas,
      modules: options.modules,
      // Always an orphan page (not in conventional navigation)
      orphan: true,
      browser: {
        baseConstruct: 'AposFancyPage'
      },
      pageSettingsTemplate: 'piecePageSettings',
      // So far manager.js seems sufficient, but we could
      // use these options to provide separate files for
      // each of these components within the blog-2 module
      // editorScript: 'pieceEditor',
      // contentScript: 'pieceContent'
    });

    piecesOptions.addFields = [
      {
        // Add these new fields after the "published" field
        after: 'published',
        name: 'publicationDate',
        label: 'Publication Date',
        type: 'date'
      },
      {
        name: 'publicationTime',
        label: 'Publication Time',
        type: 'time'
      },
      {
        name: 'body',
        type: 'area',
        label: 'Body',
        // Don't show it in page settings, we'll edit it on the
        // show page
        contextual: true
      },
      // This is a virtual join allowing the user to pick a new
      // parent blog for this post. If the user chooses to populate
      // it, then a beforePutOne override will take care of
      // calling self._pages.move to do the real work
      {
        name: '_parent',
        type: 'joinByOne',
        label: 'Move to Another Blog',
        placeholder: 'Type the name of the blog',
        withType: self.indexName,
        idField: '_newParentId',
        getOptions: {
          editable: true
        }
      }
    ].concat(piecesOptions.addFields || []);

    _.defaults(piecesOptions, {
      // Rebuild the context menu, removing items that
      // make a blog post seem overly page-y and renaming
      // items in a way that feels more intuitive
      contextMenu: [
        {
          name: 'new-' + self._apos.cssName(piecesOptions.name),
          label: 'New ' + piecesOptions.label
        },
        {
          name: 'edit-page',
          label: piecesOptions.label + ' Settings'
        },
        {
          name: 'versions-page',
          label: piecesOptions.label + ' Versions'
        },
        {
          name: 'delete-' + self._apos.cssName(self.pieceName),
          label: 'Move to Trash'
        },
        {
          name: 'rescue-' + self._apos.cssName(self.pieceName),
          label: 'Rescue ' + self.pieceLabel + ' From Trash'
        }
      ]
    });
    fancyPage.FancyPage.call(self.pieces, piecesOptions, null);

    // Given an array of index pages, yields a mongodb
    // criteria object which will pass both the pieces for the
    // original pages and the pieces for any pages they aggregate
    // with, taking tag filtering into account.

    self.aggregateCriteria = function(req, _pages, callback) {

      // Shallow copy to avoid modifying argument
      pages = _.clone(_pages);

      var done = false;

      var fetched = {};
      var tagsByPageId = {};
      var recursed = {};

      _.each(pages, function(page) {
        fetched[page._id] = true;
        if (page._andFromPages) {
          _.each(page._andFromPages || [], function(pair) {
            pages.push(pair.item);
            fetched[pair.item._id] = true;
          });
          recursed[page._id] = true;
        }
      });

      return async.whilst(
        function() { return !done; },
        function(callback) {
          var ids = [];
          _.each(pages, function(page) {
            if (_.has(recursed, page._id)) {
              return;
            }
            recursed[page._id] = true;
            _.each(page.andFromPagesIds || [], function(id) {
              if (_.has(fetched, id)) {
                return;
              }
              ids.push(id);
              fetched[id] = true;
            });
          });
          if (!ids.length) {
            done = true;
            return setImmediate(callback);
          }
          return self.indexes.get(req, { _id: { $in: ids } }, { fields: { title: 1, slug: 1, path: 1, level: 1, rank: 1, andFromPagesIds: 1, andFromPagesRelationships: 1 }, withJoins: false }, function(err, results) {
            if (err) {
              return callback(err);
            }
            pages = pages.concat(results.pages);
            return callback(null);
          });
        },
        function(err) {
          if (err) {
            return callback(err);
          }

          // Recurse through the pages to build all the
          // possible tag lists by which a blog might
          // be filtered. If A aggregates B, filtering by "dog",
          // and B aggregates C, filtering by "cat", then
          // A should only aggregate posts in C that are
          // tagged both "dog" and "cat". If A and C both
          // aggregate D, things are even more interesting.

          var pagesById = {};
          var visited = {};
          _.each(pages, function(page) {
            pagesById[page._id] = page;
          });

          // Recurse everything aggregated with the original
          // group of pages
          _.each(_pages, function(page) {
            recurseTags(page, [], []);
          });

          function recurseTags(page, tags, antecedents) {
            if (_.contains(antecedents, page._id)) {
              // Avoid infinite loops. We don't forbid
              // visiting the same page twice along different
              // tag paths, but we do have to avoid getting
              // caught in situations where A aggregates C and
              // C aggregates A.
              return;
            }
            _.each(page.andFromPagesIds || [], function(id) {
              var _page = pagesById[id];
              if (_page) {
                var rel = ((page.andFromPagesRelationships || {})[id]) || {};
                var newTags;
                if (rel.tag) {
                  newTags = [ rel.tag ];
                } else {
                  newTags = [];
                }
                recurseTags(pagesById[id], tags.concat(newTags), antecedents.concat(page._id));
              }
            });
            if (!tagsByPageId[page._id]) {
              tagsByPageId[page._id] = [];
            }
            tagsByPageId[page._id].push(tags);
          }

          // Yield a series of "or" clauses for the
          // pages we've found
          var clauses = [];
          _.each(pages, function(page) {
            var clause = {
              path: new RegExp('^' + RegExp.quote(page.path + '/')),
              level: page.level + 1
            };
            var tagPaths = tagsByPageId[page._id];
            if (tagPaths) {
              if (_.find(tagPaths, function(tagPath) {
                return !tagPath.length;
              })) {
                // Along at least one path this page's
                // children are unrestricted
              } else {
                // TODO: we could optimize these
                // queries more, reducing more redundancies.
                // Then again mongodb might do it for us and
                // it's rare for this to get really out of hand
                _.each(tagPaths, function(tagPath) {
                  clause.tags = { $all: tagPath };
                });
              }
            }
            clauses.push(clause);
          });
          return callback(null, clauses);
        }
      );
    };

    var superPiecesGet = self.pieces.get;

    // The get method for pieces supports a "fromPageIds" option,
    // which retrieves only pieces that are children of the
    // specified index pages. "fromPages" is also supported,
    // allowing objects (only the path and level
    // properties are needed).
    //
    // When "fromPages" is used, any content that the specified
    // blogs aggregate from other blogs is also automatically
    // included. You do NOT need to specify all of the
    // aggregated blogs manually in fromPages.
    //
    // The get method for pieces also implements "publishedAt"
    // which can be set to "any" to return material that has not
    // reached its publication date yet.
    //
    // If the sort option has not been passed in, it will be set
    // to blog order (reverse chronological on publishedAt).

    self.pieces.get = function(req, userCriteria, options, callback) {
      var criteria;
      var filterCriteria = {};

      if (options.fromPageIds) {
        return self._apos.get(req, { _id: { $in: options.fromPageIds } }, { path: 1, level: 1, andFromPagesIds: 1, andFromPagesRelationships: 1 }, function(err, results) {
          if (err) {
            return callback(err);
          }
          // Recursive invocation now that we have enough
          // information about the pages
          var innerOptions = _.cloneDeep(options);
          delete innerOptions.fromPageIds;
          innerOptions.fromPages = results.pages;
          return self.pieces.get(req, userCriteria, innerOptions, callback);
        });
      }

      var results;

      return async.series({
        fromPages: function(callback) {
          if (!options.fromPages) {
            return setImmediate(callback);
          }
          return self.aggregateCriteria(req, options.fromPages, function(err, clauses) {
            if (err) {
              return callback(err);
            }
            if (clauses.length) {
              filterCriteria.$or = clauses;
            }
            return callback(null);
          });
        },
        get: function(callback) {
          // If options.publishedAt is 'any', we're in the admin interface and should be
          // able to see articles whose publication date has not yet arrived. Otherwise,
          // show only published stuff
          if (options.publishedAt === 'any') {
            // Do not add our usual criteria for publication date. Note
            // that userCriteria may still examine publication date
          } else {
            filterCriteria.publishedAt = { $lte: new Date() };
          }

          if (!options.sort) {
            options.sort = { publishedAt: -1 };
          }

          criteria = {
            $and: [
              userCriteria,
              filterCriteria
            ]
          };
          return superPiecesGet(req, criteria, options, function(err, _results) {
            if (err) {
              return callback(err);
            }
            results = _results;
            return callback(null);
          });
        }
      }, function(err) {
        if (err) {
          return callback(err);
        }
        return callback(null, results);
      });
    };

    self.pieces.dispatch = function(req, callback) {
      req.template = self.renderer('show');
      return callback(null);
    };

    // Denormalize the publication date and time.
    // Set the "orphan" and "reorganize" flags.
    // Force the slug to incorporate the
    // publication date.

    self.pieces.beforePutOne = function(req, slug, options, piece, callback) {
      // Pieces are always orphans - they don't appear
      // as subpages in navigation (because there are way too
      // many of them and you need to demonstrate some clue about
      // that by deliberately querying for them)
      piece.orphan = true;

      // Pieces should not clutter up the "reorganize" tree, that's why
      // equivalent features are provided in the context menu and the
      // piece settings to move between index pages, browse trash, etc.
      piece.reorganize = false;

      if (piece.publicationTime === null) {
        // Make sure we specify midnight, if we leave off the time entirely we get
        // midnight UTC, not midnight local time
        piece.publishedAt = new Date(piece.publicationDate + ' 00:00:00');
      } else {
        piece.publishedAt = new Date(piece.publicationDate + ' ' + piece.publicationTime);
      }

      if (self._dateInSlug) {
        var datePath = piece.publicationDate.replace(/-/g, '/');
        var dateSlugRegex = /\/(\d\d\d\d\/\d\d\/\d\d\/)?([^\/]+)$/;
        var matches = piece.slug.match(dateSlugRegex);
        if (!matches) {
          // This shouldn't happen, but don't crash over it
          console.error("I don't understand how to add a date to this slug: " + piece.slug);
        } else {
          piece.slug = piece.slug.replace(dateSlugRegex, '/' + datePath + '/' + matches[2]);
        }
      }

      return callback(null);
    };

    // If the user specifies a new parent via the _newParentId virtual
    // join, use the pages module to change the parent of the piece.
    self.pieces.afterPutOne = function(req, slug, options, piece, callback) {
      var newParent;
      return async.series({
        getNewParent: function(callback) {
          if (!piece._newParentId) {
            return callback(null);
          }
          return self.indexes.getOne(req, { _id: piece._newParentId }, {}, function(err, page) {
            if (err) {
              return callback(err);
            }
            newParent = page;
            return callback(null);
          });
        },
        move: function(callback) {
          if (!newParent) {
            return callback(null);
          }
          return self._pages.move(req, piece, newParent, 'inside', callback);
        }
      }, callback);
    };
  };

  // Invoke the loaders for the two fancy pages we're implementing
  self.loader = function(req, callback) {
    return async.series({
      indexes: function(callback) {
        return self.indexes.loader(req, function(err) {
          return callback(err);
        });
      },
      pieces: function(callback) {
        return self.pieces.loader(req, function(err) {
          return callback(err);
        });
      }
    }, callback);
  };

  self.setupIndexes();
  self.setupPieces();

  // By default we do want a widget for the blog
  var widgetOptions = {};
  if (self._options.widget === false) {
    widgetOptions = false;
  } else if (typeof(self._options.widget) === 'object') {
    widgetOptions = self._options.widget;
  }

  // Data to push to browser-side manager object
  var args = {
    name: self.name,
    pieceName: self.pieceName,
    pieceLabel: self.pieceLabel,
    indexName: self.indexName,
    indexLabel: self.indexLabel,
    action: self._action,
    widget: widgetOptions
  };

  // Synthesize a constructor for the manager object on the browser side
  // if there isn't one. This allows trivial subclassing of the blog for
  // cases where no custom browser side code is actually needed
  self._apos.pushGlobalCallWhen('user', 'AposBlog2.subclassIfNeeded(?, ?, ?)', getBrowserConstructor(), getBaseBrowserConstructor(), args);
  self._apos.pushGlobalCallWhen('user', '@ = new @(?)', getBrowserInstance(), getBrowserConstructor(), args);

  function getBrowserInstance() {
    if (self._browser.instance) {
      return self._browser.instance;
    }
    var c = getBrowserConstructor();
    return c.charAt(0).toLowerCase() + c.substr(1);
  }

  function getBrowserConstructor() {
    return self._browser.construct || 'Apos' + self.name.charAt(0).toUpperCase() + self.name.substr(1);
  }

  // Figure out the name of the base class constructor on the browser side. If
  // it's not explicitly set we assume we're subclassing snippets
  function getBaseBrowserConstructor() {
    return self._browser.baseConstruct || 'AposBlogManager';
  }

  if (widgetOptions) {
    // We want widgets, so construct a manager object for them.
    // Make sure it can see the main manager for the blog
    var widget = {
      _manager: self
    };
    (function(options) {
      var self = widget;
      self._apos = self._manager._apos;
      self.icon = options.icon || 'icon-blog';
      self.name = options.name || self._manager.indexes.name;
      self.label = options.label || self._manager.indexes.label;
      self.widget = true;
      self.css = self._apos.cssName(self.name);

      // For use in titling the "type part of a title" field
      var titleField = _.find(self._manager.pieces.schema, function(field) {
        return field.name === 'title';
      }) || { label: 'Title' };

      var widgetData = {
        widgetEditorClass: 'apos-' + self.css + '-widget-editor',
        pieceLabel: self._manager.pieces.label,
        pluralPieceLabel: self._manager.pieces.pluralLabel,
        indexLabel: self._manager.indexes.label,
        pluralIndexLabel: self._manager.indexes.pluralLabel,
        titleLabel: titleField.label
      };

      // Include our editor template in the markup when aposTemplates is called
      self._manager.pushAsset('template', 'widgetEditor', {
        when: 'user',
        data: widgetData
      });

      // So far we've always kept this in the same file with the rest of the module's CSS,
      // so don't clutter up the console with 404s in dev
      // self.pushAsset('stylesheet', 'widget');

      self.addCriteria = function(item, criteria, options) {
        if (item.by === 'tag') {
          if (item.tags && item.tags.length) {
            criteria.tags = { $in: item.tags };
          }
          if (item.limitByTag) {
            options.limit = item.limitByTag;
          } else {
            options.limit = 5;
          }
        } else if (item.by === 'id') {
          // Specific IDs were selected, so a limit doesn't make sense
          criteria._id = { $in: item.ids || []};
        } else if (item.by === 'fromPageIds') {
          if (item.limitFromPageIds) {
            options.limit = item.limitFromPageIds;
          } else {
            options.limit = 5;
          }
          if (item.fromPageIds && item.fromPageIds.length) {
            options.fromPageIds = item.fromPageIds;
          }
        }
      };

      self.sanitize = function(item) {
        item.by = self._apos.sanitizeSelect(item.by, [ 'id', 'tag', 'fromPageids' ], 'fromPageIds');
        item.tags = self._apos.sanitizeTags(item.tags);
        item.ids = self._apos.sanitizeIds(item.ids);
        item.fromPageIds = self._apos.sanitizeIds(item.fromPageIds);
        item.limit = self._apos.sanitizeInteger(item.limit, 5, 1, 1000);
      };

      self.renderWidget = function(data) {
        return self._manager.render('widget', data);
      };

      self.addDiffLines = function(item, lines) {
        if (item.by === 'id') {
          lines.push(self.label + ': items selected: ' + ((item.ids && item.ids.length) || 0));
        } else if (item.by === 'tag') {
          lines.push(self.label + ': tags selected: ' + item.tags.join(', '));
        } else if (item.by === 'fromPageIds') {
          lines.push(self.label + ': sources selected: ' + ((item.fromPageIds && item.fromPageIds.length) || 0));
        }
      };

      // Asynchronously load the content of the pieces we're displaying.
      // The properties you add should start with an _ to denote that
      // they shouldn't become data attributes or get stored back to MongoDB

      self.load = function(req, item, callback) {
        var criteria = {};
        var options = {};

        self.addCriteria(item, criteria, options);

        return self._manager.pieces.get(req, criteria, options, function(err, results) {
          if (err) {
            item._pieces = [];
            console.error(err);
            return callback(err);
          }
          var pieces = results.pages;
          if (item.by === 'id') {
            pieces = self._apos.orderById(item.ids, pieces);
          }
          item._pieces = pieces;
          return callback(null);
        });
      };

      self.empty = function(item) {
        return (!item._pieces) || (!item._pieces.length);
      };


    })(widgetOptions);

    // This widget should be part of the default set of widgets for areas
    // (note devs can still override the list)
    self._apos.defaultControls.push(widget.name);
    self._apos.addWidgetType(widget.name, widget);

    // For your overriding convenience; override to change the
    // server side behavior of the widget
    self.extendWidget = function(widget) {
    };

    // Call extendWidget on next tick so that there is time to
    // override it in a subclass
    process.nextTick(function() {
      self.extendWidget(widget);
    });
  }

  self._apos.on('beforeEndAssets', function() {
    self.pushAllAssets();
  });

  self.pushAllAssets = function() {
    self.pushAsset('script', 'manager', {
      when: 'user',
      data: {
        pieceName: self.pieceName,
        pieceLabel: self.pieceLabel
      }
    });
    self.pushAsset('template', 'browseTrash', {
      when: 'user',
      data: {
        browseTrashClass: 'apos-browse-trash-' + self._apos.cssName(self.pieceName),
        pluralLabel: self.pieces.pluralLabel
      }
    });
  };

  // Fetch blog posts the current user is allowed to see.
  // Accepts skip, limit, trash, search and other options
  // supported by the "get" method via req.query

  self._app.get(self._action + '/get', function(req, res) {
    var criteria = {};
    var options = {};
    self.addApiCriteria(req.query, criteria, options);
    self.pieces.get(req, criteria, options, function(err, results) {
      if (err) {
        console.error(err);
        return res.send({ status: 'error' });
      }
      results.status = 'ok';
      return res.send(results);
    });
  });

  self.addApiCriteria = function(queryArg, criteria, options) {

    // Most of the "criteria" that come in via an API call belong in options
    // (skip, limit, titleSearch, published, etc). Handle any cases that should
    // go straight to the mongo criteria object

    var query = _.cloneDeep(queryArg);

    var slug = self._apos.sanitizeString(query.slug);
    if (slug.length) {
      criteria.slug = query.slug;
      // Don't let it become an option too
      delete query.slug;
    }

    var _id = self._apos.sanitizeString(query._id);
    if (_id.length) {
      criteria._id = query._id;
      // Don't let it become an option too
      delete query._id;
    }

    // Everything else is assumed to be an option
    _.extend(options, query);

    // Make sure these are converted to numbers, but only if they are present at all
    if (options.skip !== undefined) {
      options.skip = self._apos.sanitizeInteger(options.skip);
    }
    if (options.limit !== undefined) {
      options.limit = self._apos.sanitizeInteger(options.limit);
    }
    options.editable = true;
  };

  // Move a piece to the trash. Requires 'slug' and 'trash' as
  // POST parameters. If 'trash' is true then the piece is
  // trashed, otherwise it is rescued from the trash.
  //
  // Separate from the regular trashcan for pages because blog posts
  // should remain children of their blog when they are in the trash.

  self._app.post(self._action + '/delete', function(req, res) {
    var piece;
    var parent;
    return async.series({
      get: function(callback) {
        return self.pieces.getOne(req, { type: self.pieceName, slug: self._apos.sanitizeString(req.body.slug) }, { trash: 'any' }, function(err, _piece) {
          piece = _piece;
          if (!piece) {
            return res.send({ status: 'notfound' });
          }
          return callback(err);
        });
      },
      update: function(callback) {
        var trash = self._apos.sanitizeBoolean(req.body.trash);
        var oldSlug = piece.slug;
        if (trash) {
          if (piece.trash) {
            return callback(null);
          }
          piece.trash = true;
          // Mark it in the slug too, mainly to free up the original
          // slug for new pieces, but also because it's nice for
          // debugging
          piece.slug = piece.slug.replace(/\/[^\/]+$/, function(match) {
            return match.replace(/^\//, '/♻');
          });
        } else {
          if (!piece.trash) {
            return callback(null);
          }
          piece.slug = piece.slug.replace(/\/♻[^\/]+$/, function(match) {
            return match.replace(/^\/♻/, '/');
          });
          delete piece.trash;
        }
        return self.pieces.putOne(req, oldSlug, {}, piece, callback);
      },
      findParent: function(callback) {
        self._pages.getParent(req, piece, function(err, _parent) {
          if (err || (!_parent)) {
            return callback(err || new Error('No parent'));
          }
          parent = _parent;
          return callback(null);
        });
      }
    }, function(err) {
      if (err) {
        console.error(err);
        return res.send({ status: 'error' });
      }
      return res.send({ status: 'ok', parent: parent.slug, slug: piece.slug });
    });
  });

  self._apos.addMigration('blog2AddReorganizeFlag', function(callback) {
    var needed = false;
    return self._apos.forEachPage({ type: 'blogPost', reorganize: { $ne: false } }, function(page, callback) {
      if (!needed) {
        needed = true;
        console.log('Hiding blog posts from reorganize');
      }
      return self._apos.pages.update({ _id: page._id }, { $set: { reorganize: false } }, callback);
    }, callback);
  });


  self._apos.on('tasks:register', function(taskGroups) {
    // Task name depends on what we're generating! Otherwise
    // subclasses with a different piece type crush the generate-blog-posts task
    var taskName = self._apos.camelName('generate ' + self.pieces.pluralLabel);
    taskGroups.apostrophe[taskName] = function(apos, argv, callback) {
      if (argv._.length !== 2) {
        return callback('Usage: node app apostrophe:' + taskName + ' /slug/of/parent/blog');
      }
      var req = self._apos.getTaskReq();
      var parentSlug = argv._[1];
      var parent;

      return async.series({
        getParent: function(callback) {
          return self.indexes.getOne(req, { slug: parentSlug }, {}, function(err, _parent) {
            if (err) {
              return callback(err);
            }
            if (!_parent) {
              return callback('No such parent blog page found');
            }
            parent = _parent;
            return callback(null);
          });
        },
        posts: function(callback) {
          var randomWords = require('random-words');
          var i;
          var posts = [];
          for (i = 0; (i < 100); i++) {
            var title = randomWords({ min: 5, max: 10, join: ' ' });
            var at = new Date();
            // Many past publication times and a few in the future
            // 86400 = one day in seconds, 1000 = milliseconds to seconds
            at.setTime(at.getTime() + (10 - 90 * Math.random()) * 86400 * 1000);
            var post = {
              type: 'blogPost',
              title: title,
              publishedAt: at,
              publicationDate: moment(at).format('YYYY-MM-DD'),
              publicationTime: moment(at).format('HH:MM'),
              body: {
                type: 'area',
                items: [
                  {
                    type: 'richText',
                    content: randomWords({ min: 50, max: 200, join: ' ' })
                  }
                ]
              }
            };
            if (Math.random() > 0.2) {
              post.published = true;
            }
            posts.push(post);
          }
          return async.eachSeries(posts, function(post, callback) {
            return self.pieces.putOne(req,
              undefined,
              { parent: parent },
              post,
              callback);
          }, callback);
        }
      }, callback);
    };
  });

  self._apos.on('addSearchFilters', function(searchFilters) {
    searchFilters.push({
      name: self.pieceName,
      label: self.pieces.pluralLabel
    });
  });

  if (callback) {
    process.nextTick(function() {
      return callback();
    });
  }
};
