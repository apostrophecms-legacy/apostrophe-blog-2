## NOT FOR NEW PROJECTS

This module is for the 0.5.x version of Apostrophe. The [apostrophe-blog](https://npmjs.org/apostrophe-blog) module has been updated for Apostrophe 2.x.

Some of the use cases of this module are not yet available as a pre-packaged module for 2.x, however you can recreate them using `apostrophe-custom-pages`, a built-in module of 2.x.

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

## Do you like dates in slugs?

By default, the date is part of the slug of each post:

```
/my/blog/2014/11/12/wednesday-update
```

If this doesn't suit your needs, just set the `dateInSlug` option to `false`.

If you are reading this late and already have content with dates, you can remove them:

```
node app apostrophe:remove-dates-from-blog-posts
```

(Note: if you are subclassing, the name of the task depends on your `pieceName` setting. Type `node app apostrophe:help` to list available tasks.)

If you change your mind and want to add dates back, just run:

```
node app apostrophe:add-dates-to-blog-posts
```

Either way, be sure to set the `dateInSlug` option correctly in your module configuration to ensure future posts behave as you expect.

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

### Preserving author credit

The Wordpress import task will migrate in the author's name for each blog post via the `dc:creator` setting found in the XML export file. This field is assigned to the `credit` property of each post in A2. You can add that field to your `pieces` schema as a string field to make it editable on your A2 site.

### Additional options

### Specifying the base URL for relative links

Usually the `wp:base_blog_url` found in the XML export file is good enough to resolve relative URLs to image files if any are encountered in the XML.

However some sites are too tricky with redirects and subdomains for their own good, and you'll need to tell the import task what the real URL of the original Wordpress site is:

`--base=http://magazine.example.com`

#### Ignoring tags

By default Wordpress tags are imported as A2 tags. To prevent this, use the `--ignore-tags` option.

#### Ignoring categories

Wordpress categories are also imported as A2 tags. You can prevent this with the `--ignore-categories` option.

#### Importing only posts with a specific tag

Just use:

`--with-tag="Zamfir Pipes"`

Yes, you may use this option and `--ignore-tags` at the same time.

#### Importing only posts with a specific category

I bet you can guess:

`--with-category="French Press"`

Yes, it is safe to combine this with `--ignore-categories`.

#### Importing only posts that do not have certain tags

`--without-tags="tag1,tag2,tag3"`

Useful if you need to export a "misc" blog with all the content you didn't export to other blogs via `--with-tag`.

This option does not currently work with tags that contain
commas in their names.

#### Importing only posts that do not have certain categories

Useful if you need to export a "misc" blog with all the content you didn't export to other blogs via `--with-category`.

`--without-categories="cat1,cat2,cat3"

This option does not currently work with categories that contain
commas in their names.

#### Changing the body area name

By default, the importer assumes the main content area of your blog posts is named `body`. This might not be the case in your templates. If not, specify `--body-area=content1`, or whatever your area name is.

#### Mapping [caption] shortcodes to descriptions

By default, a [caption] shortcode becomes the title of the file, and the "showTitles" flag is set on the slideshow.

If you prefer it be treated as a description, pass the `--caption-as-description` option.

#### Newline-to-line-break conversion

By default, Wordpress blogs convert double newlines to paragraph breaks. They do it on the fly, all the time, with a hideously complex function. Yes, it's pretty terrible.

By default, during the import, we convert these to a simple pair of `br` tags.

If your particular Wordpress blog has this feature disabled, specify `--no-autop` during import to prevent this conversion, which is redundant for you.

#### Converting creator names

The `dc:creator` setting from Wordpress is normally imported directly into the `credit` field in A2. If you wish, you can specify a CSV file in which the first column is the `dc:creator` value (the Wordpress username) and the second column is the `credit` property to store in A2. Just use:

`--creator-to-credit=filename.csv`

#### Doing it faster

To import the blog faster, processing four blog posts at once, specify `--parallel=4`. Be aware this can require much more memory when importing images. It may also impose an unacceptable load on the Wordpress site at some point. `4` is a good limit, and only on a laptop or a VPS with plenty of memory.
