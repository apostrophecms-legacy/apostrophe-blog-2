/* jshint node:true */

module.exports = function(self, argv, callback) {
  return self._apos.forEachPage({ type: self.pieceName }, {}, function(piece, callback) {
    var oldSlug = piece.slug;
    self.pieces.addDateToSlug(piece, true);

    function attempt() {
      return self._apos.pages.update({
        slug: oldSlug
      }, {
        $set: {
          slug: piece.slug
        }
      }, function(err) {
        if (!err) {
          return callback(null);
        }
        // Careful, removing the date can make
        // slugs no longer unique, resolve that
        if (self._apos.isUniqueError(err))
        {
          var num = (Math.floor(Math.random() * 10)).toString();
          piece.slug += num;
          return attempt();
        }
        return callback(err);
      });
    }

    attempt();

  }, callback);
};

