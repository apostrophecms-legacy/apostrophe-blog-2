// JavaScript which enables editing of this module's content belongs here.

function AposBlog(options) {
  var self = this;
  AposFancyPage.call(self, options);
  $('body').on('click', '[data-new-' + apos.cssName(options.pieceName) + ']', function() {
    var page = apos.data.aposPages.page;

    // Works from the blog page, and also from its subpages
    // (presumably blog posts)
    if (page.type !== self.name) {
      if (apos.data.aposPages.page.parent.type !== self.name) {
        return false;
      }
      page = apos.data.aposPages.page.parent;
    }
    // Menu item title = modal dialog title. A good workaround for
    // not having page type specific modals
    var title = $(this).text();
    var $el = aposPages.newPage(page.slug, { type: options.pieceName, title: title });
    return false;
  });
}

