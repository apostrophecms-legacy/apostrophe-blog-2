/* jshint node:true */

module.exports = function(self, argv, callback) {
  return self._apos.forEachPage({ type: self.pieceName }, {}, function(piece, callback) {
    var oldSlug = piece.slug;
    self.pieces.addDateToSlug(piece, true);
    return self._apos.pages.update({
      slug: oldSlug
    }, {
      $set: {
        slug: piece.slug
      }
    }, callback);
  }, callback);
};

