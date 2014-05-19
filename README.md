# A work in progress

See the apostrophe-blog module for a mature blog for use with A2.

This new implementation is based on the idea that blog posts have more in common with pages than with snippets. It simplifies permissions and makes the whole experience more contextual.

## Options

Blog posts cannot have subpages. And, by default, index pages can't have subpages other than blog posts. But you can enable the latter by setting the `allowSubpagesOfIndex` option to `true` when configuring the module. It's not forbidden, it's just confusing for users who don't need it.

## Subclassing
For now, subclassing of blog-2 is fairly simple, though it requires some configuration in your app.js file. Here's a sample of what you'll need to successfully subclass and create your own distinct instance of a blog-like thing:

```JavaScript
'handbook': {
    extend: 'apostrophe-blog-2',
    name: 'handbooks',
    pieceName: 'policy',
    pieceLabel: 'Policy',
    indexName: 'handbook',
    indexLabel: 'Handbook',
    pieces: {
      pluralLabel: 'Policies',
    }
  }
```
