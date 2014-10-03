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

## Wordpress Import

You can import content from Wordpress blogs into `apostrophe-blog-2`:

```
node app apostrophe:import-wordpress-stories wordpress-export-file.xml /my-blog
```

The first argument must be a Wordpress XML export file. The second argument must be the slug of an existing blog page on your A2 site.

You can generate a Wordpress export file easily:

1. Log into your wordpress site as an admin.
2. Click "tools."
3. Click "export."
4. Select "posts" or "all." NOTE: only blog posts and associated images and video will be imported. Pages are NOT imported.
5. Save the resulting export file.

### Limitations

Currently Wordpress import does not import categories or tags. Obviously this needs to change. We intend to support options to import a specific category or tag only, and to turn categories and tags into A2 tags.

### Additional Options

#### Changing the body area name

By default, the importer assumes the main content area of your blog posts is named `body`. This might not be the case in your templates. If not, specify `--body-area=content1`, or whatever your area name is.

#### Doing it faster

To do it faster, processing four blog posts at once, specify `--parallel=4`. Be aware this can require much more memory when importing images.

