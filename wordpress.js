var xml2js = require('xml2js');
var fs = require('fs');
var util = require('util');
var async = require('async');
var moment = require('moment');
var _ = require('lodash');
var cheerio = require('cheerio');
var splitHtml = require('split-html');
var path = require('path');
var request = require('request');
var util = require('util');

module.exports = function(self, argv, callback) {
  var data;
  var parent;
  var req = self._apos.getTaskReq();
  return async.series({
    usage: function(callback) {
      if (argv._.length !== 3)
      {
        return callback('The first argument must be a Wordpress XML export filename. The second argument must be the slug of an existing blog page on your A2 site.');
      }
      return callback(null);
    },
    getParent: function(callback) {
      return self.indexes.getOne(req, { slug: argv._[2] }, {}, function(err, _parent) {
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
    parse: function(callback) {
      return xml2js.parseString(fs.readFileSync(argv._[1], 'utf8'), function(err, result) {
        if (err) {
          return callback(err);
        }
        data = result;
        return callback(null);
      });
    },
    insert: function(callback) {
      var count = 0;
      var documents = data.rss.channel[0].item;
      posts = _.filter(documents, function(post) {
        return (post['wp:post_type'] && (post['wp:post_type'][0] === 'post'));
      });

      // Optional parallel processing
      return async.eachLimit(posts, argv.parallel || 1, function(post, callback) {
        var html = post['content:encoded'][0];
        count++;
        console.log(post['title'][0] + ': ' + count + ' of ' + posts.length);
        var publishedAt = new Date(post.pubDate[0]);
        var items = [];

        return async.series({
          meta: function(callback) {
            return async.eachSeries(post['wp:postmeta'] || [], function(meta, callback) {
              var key = meta['wp:meta_key'] && meta['wp:meta_key'][0];
              var code = meta['wp:meta_value'] && meta['wp:meta_value'][0];
              if (key === 'embed') {
                var matches = code.match(/(http"|https:)?\/\/[^'"]+/);
                if (matches) {
                  return self._apos.acceptVideo(req, { url: matches[0] }, function(err, video) {
                    if (err) {
                      console.error('WARNING: Apostrophe couldn\'t figure out what to do with this embedded item: ' + code);
                    } else {
                      items.push({
                        type: (video.type === "video") ? 'video' : 'embed',
                        video: matches[0],
                        thumbnail: video.thumbnail
                      });
                    }
                    return callback(null);
                  });
                }
              }
              return setImmediate(callback);
            }, callback);
          },
          body: function(callback) {

            // Cope with non-container shortcodes by special-
            // casing them and turning into HTML tags for our
            // HTML parser. Add new ones in alternation
            // with | in the regex below. This is the only
            // way to go because they don't have an XHTML-style
            // self-closing notation.

            html = html.replace(/\[(portfolio_slideshow)(.*?)\]/g, function(everything, name, attributes) {
              return '<wps' + name + attributes + ' />';
            });

            // Cope with container shortcodes by converting their
            // syntax so that they appear as HTML tags to
            // our HTML parser.

            var before = html;
            html = html.replace(/\[(\w+)(.*?)\](.*?)\[\/(\w+)\]/g, function(everything, name, attributes, body, closeName) {
              return '<wps' + name + attributes + '>' + body + '</wps' + closeName + '>';
            });

            // Split the markup up into an alternation of
            // special cases with chunks of ordinary markup.

            // Special cases are currently: [youtube], [vimeo], [caption],
            // and <a><img /></a>.

            var fragments = splitHtml(html, 'wpsportfolio_slideshow, wpsbutton, wpsyoutube, wpsvimeo, wpscaption, a', function($el) {
              if ($el[0].name === 'a') {
                return $el.find('img').length;
              } else {
                return true;
              }
            });

            var i = 0;
            return async.eachSeries(fragments, function(fragment, callback) {
              var isSpecial = i & 1;
              i++;
              if (!isSpecial) {
                // In Wordpress, every double newline
                // is a paragraph break. This is accomplished
                // with this hideously complex function on
                // every single page render:

                // https://core.trac.wordpress.org/browser/tags/4.0/src/wp-includes/formatting.php#L0

                // We are not going to do any such terrible thing.
                // We import them as a simple pair of br's. People
                // can make nice paragraphs later in our editor
                // if they want, but I can't dice this sushi.
                //
                // Offer an option not to do this since a few
                // Wordpress blogs may have it turned off. -Tom

                if (!argv['no-autop']) {
                  fragment = fragment.replace(/\r?\n\r?\n/g, '<br />\n<br />\n');
                }

                var item = {
                  type: 'richText',
                  content: fragment
                };
                self._apos.itemTypes.richText.sanitize(item);
                items.push(item);
                return setImmediate(callback);
              }
              var $ = cheerio.load('<div>' + fragment + '</div>');

              var $img = $('img');
              if ($img.length) {
                // wpscaption, or img inside a, or just plain img
                var src = $img.attr('src');
                var href = $('a').attr('href');
                // Sometimes it's an attribute...
                var title = $('wpscaption').attr('caption');
                if (!title) {
                  // But sometimes it's a text node, because
                  // why the hell not?
                  title = $('wpscaption').text().trim();
                }
                if (href && src) {
                  if (path.extname(href) === path.extname(src)) {
                    // The 'a' is a link to a better version
                    // of the image
                    src = href;
                  }
                }
                if (!src) {
                  console.error('WARNING: missing image URL, ignoring image');
                  return setImmediate(callback);
                }
                // encoding: null to get the binary file as a
                // buffer rather than a UTF8 string
                return request(src, { encoding: null }, function(err, response, body) {
                  if (err || (response.status >= 300)) {
                    console.error('WARNING: image ' + src + ' not accessible, ignoring');
                    return setImmediate(callback);
                  }
                  var tmp = self._apos.uploadfs.getTempPath();
                  var name = self._apos.generateId();
                  tmp += '/' + name;
                  fs.writeFileSync(tmp, body);
                  name = path.basename(src);
                  return self._apos.acceptFiles(req, { path: tmp, name: name }, function(err, infos) {
                    if (err) {
                      return callback(err);
                    }
                    if (!infos.length) {
                      console.error('WARNING: image ' + src + ' downloaded by not accepted by Apostrophe');
                      return callback(null);
                    }
                    // acceptFiles doesn't take metadata because
                    // annotation is a later pass in the Apostrophe
                    // UI. So add the title now if we got one.

                    var file = infos[0];
                    var showTitles = false;
                    var showDescriptions = false;
                    if (title) {
                      if (argv['caption-as-description']) {
                        file.description = title;
                        showDescriptions = true;
                      } else {
                        file.title = title;
                        showTitle = true;
                      }
                    }
                    return self._apos.files.update({
                      _id: infos[0]._id
                    }, {
                      $set: {
                        title: title || infos[0].title,
                        description: title || ''
                      }
                    }, function(err) {
                      items.push({
                        type: 'slideshow',
                        ids: [ infos[0]._id ],
                        showTitles: showTitles,
                        showDescriptions: showDescriptions
                      });
                      return callback(null);
                    });
                  });
                });
              } else if ($('wpsyoutube').length || $('wpsvimeo').length) {
                // simple video shortcodes
                var url = $('wpsyoutube, wpsvimeo').text().trim();
                console.log(post.title[0] + ' has video');
                return self._apos.acceptVideo(req, { url: url }, function(err, video) {
                  if (err) {
                    console.error('WARNING: Apostrophe couldn\'t figure out what to do with this embedded item: ' + url);
                  } else {
                    items.push({
                      type: 'video',
                      video: url,
                      thumbnail: video.thumbnail
                    });
                  }
                  return callback(null);
                });
              } else if ($('wpsportfolio_slideshow').length) {
                var excluded = [];
                var exclude = $('wpsportfolio_slideshow').attr('exclude');
                if (exclude && exclude.length) {
                  excluded = exclude.split(/\s*,\s*/);
                }
                // these are joined to attachment "posts" via
                // the wp:post_parent property. Find the slides
                // and make a slideshow

                var images = [];
                _.each(documents, function(slide) {
                  if (_.contains(excluded, slide['wp:post_id'][0])) {
                    console.log('excluding');
                    return;
                  }
                  if (!slide['wp:post_parent']) {
                    console.log('no parent');
                    return;
                  }
                  if (!((slide['wp:post_type'][0] == 'attachment') && (slide['wp:post_parent'][0] == post['wp:post_id'][0]))) {
                    return;
                  }
                  if (!slide['wp:attachment_url']) {
                    console.log('NO ATTACHMENT URL');
                    return;
                  }
                  images.push(slide['wp:attachment_url'][0]);
                });
                var candidates = [];
                return async.series({
                  get: function(callback) {
                    return async.eachSeries(images, function(image, callback) {
                      return request(image, { encoding: null }, function(err, response, body) {
                          if (err) {
                            console.error(err);
                            return setImmediate(callback);
                          }
                          var tmp = self._apos.uploadfs.getTempPath();
                          var name = self._apos.generateId();
                          tmp += '/' + name;
                          fs.writeFileSync(tmp, body);
                          name = path.basename(image);
                          candidates.push({ path: tmp, name: name });
                          return callback(null);
                        }
                      );
                    }, callback);
                  },
                  accept: function(callback) {
                    return self._apos.acceptFiles(req, candidates, function(err, infos) {
                      if (err) {
                        return callback(err);
                      }
                      items.push({
                        type: 'slideshow',
                        ids: _.pluck(infos, '_id')
                      });
                      return callback(null);
                    });
                  }
                }, callback);
              } else {
                return callback(new Error('Unexpected special, our parser should not have allowed that to happen: ' + fragment));
              }
            }, function(err) {
              if (err) {
                return callback(err);
              }
              var bodyArea = argv['body-area'] || 'body';
              var a2Post = {
                type: self.pieceName,
                title: post.title[0],
                publishedAt: publishedAt,
                publicationDate: moment(publishedAt).format('YYYY-MM-DD'),
                publicationTime: moment(publishedAt).format('HH:MM')
              };
              a2Post[bodyArea] = {
                type: 'area',
                items: items
              };
              if (post['wp:status'] && post['wp:status'][0] === 'publish') {
                a2Post.published = true;
              }
              return self.pieces.putOne(req,
                undefined,
                { parent: parent },
                a2Post,
                callback);
            }, callback);
          }
        }, callback);
      }, callback);
    }
  }, callback);
};
