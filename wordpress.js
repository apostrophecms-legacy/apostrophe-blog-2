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
        // console.log(util.inspect(result.rss.channel[0].item, { depth: 4 }));
        return callback(null);
      });
    },
    insert: function(callback) {
      var count = 0;
      var posts = data.rss.channel[0].item;
      posts = _.filter(posts, function(post) {
        return (post['wp:post_type'] && (post['wp:post_type'][0] === 'post'));
      });

      // Optional parallel processing
      return async.eachLimit(posts, argv.parallel || 1, function(post, callback) {
        var html = post['content:encoded'][0];
        count++;
        console.log(count + ' of ' + posts.length);
        var publishedAt = new Date(post.pubDate[0]);
        var items = [];

        return async.series({
          meta: function(callback) {
            return async.eachSeries(post['wp:postmeta'] || [], function(meta, callback) {
              var key = meta['wp:meta_key'] && meta['wp:meta_key'][0];
              var code = meta['wp:meta_value'] && meta['wp:meta_value'][0];
              // if (code.match(/105895429/)) {
              //   console.log(key);
              //   console.log(code);
              // }
              if (key === 'embed') {
                var matches = code.match(/(http"|https:)?\/\/[^'"]+/);
                if (matches) {
                  return self._apos.acceptVideo(req, { url: matches[0] }, function(err, video) {
                    if (err) {
                      console.log('WARNING: Apostrophe couldn\'t figure out what to do with this embedded item: ' + code);
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

            var fragments = splitHtml(html, 'a', function($el) {
              return $el.find('img').length;
            });

            var i = 0;
            return async.eachSeries(fragments, function(fragment, callback) {
              // Every other fragment is an 'a' with an 'img' in it
              var isImage = i & 1;
              i++;
              if (!isImage) {
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
              var src = $img.attr('src');
              var href = $('a').attr('href');
              if (href && src) {
                if (path.extname(href) === path.extname(src)) {
                  // The 'a' is a link to a better version
                  // of the image
                  src = href;
                }
              }
              // encoding: null to get the binary file as a
              // buffer rather than a UTF8 string
              return request(src, { encoding: null }, function(err, response, body) {
                if (err || (response.status >= 300)) {
                  console.log('WARNING: image ' + src + ' not accessible, ignoring');
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
                    console.log('WARNING: image ' + src + ' downloaded by not accepted by Apostrophe');
                    return callback(null);
                  }
                  items.push({
                    type: 'slideshow',
                    ids: [ infos[0]._id ]
                  });
                  return callback(null);
                });
              });
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
              // console.log(util.inspect(a2Post, { depth: 4 }));
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
