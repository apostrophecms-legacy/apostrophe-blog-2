var async = require('async');
var _ = require('lodash');
var fancyPage = require('apostrophe-fancy-page');
var RSS = require('rss');
var url = require('url');
var absolution = require('absolution');

module.exports = blog;

function blog(options, callback) {
  return new blog.Blog(options, callback);
}

blog.Blog = function(options, callback) {
  var self = this;

  options.modules = (options.modules || []).concat([ { dir: __dirname, name: 'blog-2' } ]);

  self._apos = options.apos;
  self._app = options.app;
  self._pages = options.pages;
  self._schemas = options.schemas;
  self._options = options;

  // Mix in the ability to serve assets and templates
  self._apos.mixinModuleAssets(self, 'fancyPage', __dirname, options);

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
      name: 'blog',
      label: 'Blog',
      pieceLabel: 'Post',
      pieceName: 'blogPost',
      apos: options.apos,
      app: options.app,
      pages: options.pages,
      schemas: options.schemas,
      modules: options.modules,
      browser: {
        baseConstruct: 'AposFancyPage',
        options: {}
      },
      addFields: [
        {
          name: '_andFromPages',
          label: 'And From These Blogs',
          type: 'joinByArray',
          idsField: 'andFromPagesIds',
          withType: 'blog'
        }
      ].concat(indexesOptions.addFields || []),
      pageSettingsTemplate: 'indexPageSettings',
      editorScript: 'indexEditor',
      contentScript: 'indexContent'
    });
    _.defaults(indexesOptions, {
      // Rebuild the context menu, renaming items and
      // throwing in a new one
      contextMenu: [
        {
          name: 'new-' + self._apos.cssName(indexesOptions.pieceName),
          label: 'New ' + indexesOptions.pieceLabel
        },
        {
          name: 'new-page',
          label: 'New Page'
        },
        {
          name: 'edit-page',
          label: indexesOptions.label + ' Settings'
        },
        {
          name: 'versions-page',
          label: 'Page Versions'
        },
        {
          name: 'delete-page',
          label: 'Move to Trash'
        },
        {
          name: 'reorganize-page',
          label: 'Reorganize'
        }
      ]
    });
    _.defaults(indexesOptions.browser.options, {
      pieceName: indexesOptions.pieceName,
      pieceLabel: indexesOptions.pieceLabel
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
            req.extras.allTags = results.tags;

            // Make the filter metadata (like tag lists) available to the template
            req.extras.filters = _.omit(results, 'pages');
            return callback(null);
          });
        },
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
    options.fetch = {
      tags: { parameter: 'tag' }
    };
    if (req.page.withTags && req.page.withTags.length) {
      options.tags = req.page.withTags;
    }
    if (req.page.notTags && req.page.notTags.length) {
      options.notTags = req.page.notTags;
      // This restriction also applies when fetching distinct tags
      options.fetch.tags.except = req.page.notTags;
    }
    if (req.query.tag) {
      // Override the criteria for fetching pieces but leave options.fetch.tags
      // alone
      var tag = self._apos.sanitizeString(req.query.tag);
      if (tag.length) {
        // Page is not tag restricted, or user is filtering by a tag included on that
        // list, so we can just use the filter tag as options.tag
        if ((!options.tags) || (!options.tags.length) ||
          (_.contains(options.tags, tag))) {
          options.tags = [ tag ];
        } else {
          // Page is tag restricted and user wants to filter by a related tag not
          // on that list - we must be more devious so that both sets of
          // restrictions apply
          criteria.tags = { $in: options.tags };
          options.tags = [ tag ];
        }
        // Always return the active tag as one of the filter choices even if
        // there are no results in this situation. Otherwise the user may not be
        // able to see the state of the filter (for instance if it is expressed
        // as a select element)
        options.fetch.tags.always = tag;
      }
    }

    options.fromPages = [ req.page ];
    if (req.page._andFromPages) {
      options.fromPages = options.fromPages.concat(req.page._andFromPages);
    }
    // Admins have to be able to see unpublished content because they have to get
    // to it to edit it and there is no "manage" dialog needed anymore
    // criteria.published = true;
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
      name: 'blogPost',
      label: 'Post',
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
      addFields: [
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
        }
      ].concat(piecesOptions.addFields || []),
      pageSettingsTemplate: 'piecePageSettings',
      editorScript: 'pieceEditor',
      contentScript: 'pieceContent'
    });
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
          name: 'delete-page',
          label: 'Move to Trash'
        }
      ]
    });
    fancyPage.FancyPage.call(self.pieces, piecesOptions, null);
    var superPiecesGet = self.pieces.get;

    // The get method for pieces supports a "fromPages" option, which retrieves only
    // pieces that are children of the specified index page objects (only the
    // path and level properties are needed). addCriteria sets this up for the current
    // index page, plus any pages the user has elected to aggregate it with.
    //
    // The get method for pieces also implements "publishedAt" which can be
    // set to "any" to return material that has not reached its publication date yet.
    //
    // If the sort option has not been passed in, it will be set to blog order
    // (reverse chronological on publishedAt).

    self.pieces.get = function(req, userCriteria, options, callback) {
      var criteria;
      var filterCriteria = {};
      if (options.fromPages) {
        var clauses = [];
        _.each(options.fromPages, function(page) {
          clauses.push({ path: new RegExp('^' + RegExp.quote(page.path + '/')), level: page.level + 1 });
        });
        if (clauses.length) {
          if (clauses.length === 1) {
            filterCriteria = clauses[0];
          } else {
            filterCriteria.$or = clauses;
          }
        }
      }
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

      return superPiecesGet(req, criteria, options, callback);
    };

    self.pieces.dispatch = function(req, callback) {
      req.template = self.renderer('show');
      return callback(null);
    };

    // Denormalize the publication date and time
    self.pieces.beforePutOne = function(req, slug, options, piece, callback) {
      // Pieces are always orphans - they don't appear
      // as subpages in navigation (because there are way too
      // many of them and you need to demonstrate some clue about
      // that by deliberately querying for them)
      piece.orphan = true;
      if (piece.publicationTime === null) {
        // Make sure we specify midnight, if we leave off the time entirely we get
        // midnight UTC, not midnight local time
        piece.publishedAt = new Date(piece.publicationDate + ' 00:00:00');
      } else {
        piece.publishedAt = new Date(piece.publicationDate + ' ' + piece.publicationTime);
      }
      return callback(null);
    };
  };

  // Invoke the loaders for the two fancy pages we're implementing
  self.loader = function(req, callback) {
    return async.series({
      indexes: function(callback) {
        return self.indexes.loader(req, callback);
      },
      pieces: function(callback) {
        return self.pieces.loader(req, callback);
      }
    }, callback);
  };

  self.setupIndexes();
  self.setupPieces();

  if (callback) {
    process.nextTick(function() {
      return callback();
    });
  }
};

