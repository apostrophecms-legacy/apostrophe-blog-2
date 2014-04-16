var _ = require('lodash');
var async = require('async');

module.exports = widget;

function widget(options) {
  return new widget.Widget(options);
}

widget.Widget = function(options) {
  var self = this;
  self._apos = options.apos;
  self._app = options.app;
  self.blog = options.blog;
  self.icon = options.icon;

  self.name = options.name || self._blog.indexes.name;
  self.label = options.label || self._blog.indexes.label;

  // One asset folder for the whole blog module is fine
  self.pushAsset = function(type, name, options) {
    self._blog.pushAsset(type, name, options);
  };

  // This widget should be part of the default set of widgets for areas
  // (note devs can still override the list)
  self._apos.defaultControls.push(self.name);

  // For use in titling the "type part of a title" field
  var titleField = _.find(self._blog.pieces.schema, function(field) {
    return field.name === 'title';
  }) || { label: 'Title' };

  // Include our editor template in the markup when aposTemplates is called
  self.pushAsset('template', 'widgetEditor', {
    when: 'user',
    data: {
      widgetEditorClass: 'apos-' + self.snippets._pluralCss + '-widget-editor',
      instanceLabel: self._blog.pieces.label,
      pluralLabel: self._blog.pieces.pluralLabel || self._blog.pieces.label + 's',
      titleLabel: titleField.label
    }
  });

  // So far we've always kept this in the same file with the rest of the module's CSS,
  // so don't clutter up the console with 404s in dev
  // self.pushAsset('stylesheet', 'widget');

  self.addCriteria = function(item, criteria, options) {
    if ((item.by === 'tag') && (item.tags)) {
      if (item.tags.length) {
        criteria.tags = { $in: item.tags };
      }
      if (item.limit) {
        options.limit = item.limit;
      } else {
        // Always set an upper limit
        options.limit = 1000;
      }
    } else if ((item.by === 'id') && (item.ids)) {
      // Specific IDs were selected, do not look at the limit
      criteria._id = { $in: item.ids };
    } else if (item.fromPageIds) {
      options.fromPageIds = item.fromPageIds;
    }
  };

  self.widget = true;
  self.css = self._apos.cssName(self.name);
  self.sanitize = function(item) {
    item.by += '';
    item.tags = self._apos.sanitizeTags(item.tags);
    if (!Array.isArray(item.ids)) {
      item.ids = [];
    }
    item.ids = _.map(item.ids, function(id) {
      // Must be string
      id = self._apos.sanitizeString(id);
      return id;
    });
    item.fromPageIds = self._apos.sanitizeIds(item.fromPageIds);
    item.limit = self._apos.sanitizeInteger(item.limit, 5, 1, 1000);
  };

  self.renderWidget = function(data) {
    return self.snippets.render('widget', data);
  };

  // Snippet text contributes to the plaintext of a page
  self.getPlaintext = function(item, lines) {
    var s = '';
    _.each(item._snippets, function(snippet) {
      s += self._apos.getSearchTextsForPage(snippet) + "\n";
    });
    return s;
  };

  // Snippet text contributes to search text of page only if the link is
  // firm - made via id - and not dynamic - made via tag
  self.addSearchTexts = function(item, texts) {
    if (item.by === 'id') {
      _.each(item._snippets, function(snippet) {
        var pageTexts = self._apos.getSearchTextsForPage(snippet);
        // We have to do this because we are updating texts by reference
        _.each(pageTexts, function (text) {
          texts.push(text);
        });
      });
    }
  };

  self.addDiffLines = function(item, lines) {
    if (item.by === 'id') {
      lines.push(self.label + ': items selected: ' + ((item.ids && item.ids.length) || 0));
    } else if (item.by === 'tag') {
      lines.push(self.label + ': tags selected: ' + item.tags.join(', '));
    } else if (item.by === 'blog') {
      lines.push(self.label + ': blogs selected: ' + ((item.fromPageIds && item.fromPageIds.length) || 0));
    }
  };

  // Asynchronously load the content of the snippets we're reusing.
  // The properties you add should start with an _ to denote that
  // they shouldn't become data attributes or get stored back to MongoDB

  self.load = function(req, item, callback) {
    var criteria = {};
    var options = {};

    self.addCriteria(item, criteria, options);

    return self._blog.pieces.get(req, criteria, options, function(err, results) {
      if (err) {
        item._pieces = [];
        console.log(err);
        return callback(err);
      }
      var pieces = results.pieces;
      if (item.by === 'id') {
        pieces = self._apos.orderById(item.ids, pieces);
      }
      function send(err) {
        if (err) {
          return callback(err);
        }
        item._pieces = pieces;
        return callback(null);
      }
    });
  };

  self.empty = function(item) {
    return (!item._pieces) || (!item._pieces.length);
  };
};

