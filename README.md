# apostrophe-blog-2: a better blog for Apostrophe

This new implementation is based on the idea that blog posts have more in common with pages than with snippets. It simplifies permissions and makes the whole experience more contextual.

Each blog post is a child of its parent blog. This allows permissions to work just like page permissions in Apostrophe. However, the pagination of posts works as you would expect it to in a post, and the posts don't clutter up the "reorganize" modal.

A blog can still choose to display content from other blogs on the site. This is easy to do via the page settings of the blog (see the "and these blogs" field).

There is also a widget available for displaying blog posts anywhere on the site.

## Configuration Options

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

## Limiting Choices in the Widget

Sometimes you won't want the editor to have their pick of title, tag and particular blogs as sources for a particular widget. For instance, you might want to restrict to title only for simplicity.

You can do that with the `sources` option when inserting the widget:

```markup
{{ aposSingleton(page, 'articles', 'blog', { sources: [ 'title' ] }) }}
```

The `sources` option may contain `title`, `tag` and/or `page` in any order. The first option given becomes the default choice.

If you limit the editor to only one source, the dropdown menu is automatically hidden.
