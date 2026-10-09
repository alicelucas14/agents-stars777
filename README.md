# Stars777 Big Agents – site + blog admin (no WordPress, no plugins)

Your WordPress site exported to static HTML, plus a small self-hosted admin
panel for writing and editing blog posts the way you did in WordPress.

```
server.js            web server: public site + /admin + API
admin/               admin panel (login, posts, editor, media, settings)
cms/                 content store, page generator, auth
content/posts/       one JSON file per blog post (your 144 imported posts)
content/pages/       one JSON file per page created in the admin (Pages)
content/menu.json    header menu (created the first time you save the Menu)
content/terms.json   categories, tags, authors
content/seo.json     SEO settings, redirects, static-page + category/tag SEO
content/templates/   theme "shells" captured from the original site
site/                the public website (HTML, CSS, JS, images)
tools/               mirror.js, import-wp.js, set-password.js
```

## Run it
```powershell
npm install
npm start                  # http://localhost:3000  (set PORT=8777 to change)
```
Admin panel: **http://localhost:3000/admin/**  
On the very first start an `admin` account is created and its password is printed
in the console. Change it under **Settings** or with
`node tools/set-password.js admin <new-password>`.

## What the admin can do
- Write / edit / delete posts with a rich-text editor (TinyMCE, self-hosted)
- Drafts, preview, publish, unpublish, publish date, author
- Permalink (slug) editing – a 301 redirect from the old URL is added automatically
- Categories, tags (with "most used" suggestions), featured image
- Media library with drag-and-drop uploads (`site/wp-content/uploads/YYYY/MM/`)
- **Pages**: create new pages (same editor + SEO box) published at `/<slug>/` with the
  site header/footer; added to the sitemap; option to hide the page title
- **Menu**: add / rename / reorder / remove header-menu links (desktop + mobile);
  saving updates every page on the site. Sub-menus are not supported.
- Original Elementor pages (home etc.) keep their design – only their SEO is editable

### SEO (replaces Rank Math)
**Per post** (SEO box under the editor):
- Focus keyword, live SEO score (0–100) and a checklist of more than 15 checks
- SEO title + meta description with length meters and a desktop/mobile Google preview
- Advanced: canonical URL, robots (noindex, nofollow, noarchive, noimageindex, nosnippet), schema type
- Social: Facebook/Open Graph and Twitter title, description and image, with live previews

**SEO screen** (sidebar → SEO):
- Titles & Meta: separator, title templates (`%title% %sep% %sitename%` …), default share image, default schema
- Social & Schema: Organization/Person, name, logo, social profiles (`sameAs`), Facebook page, Twitter handle
- Indexing & Sitemap: noindex rules for category, tag, author and paginated archives; sitemap contents; RSS feed
- Webmaster Tools: Google, Bing, Yandex, Pinterest and Baidu verification; custom `<head>` code
- robots.txt editor
- Redirects manager (301/302)
- Static Pages: title, description, canonical, OG and noindex for the homepage and other non-blog pages
- Categories & Tags: rename, SEO title, description, noindex

Added to every page automatically: JSON-LD (Organization, WebSite, WebPage, BreadcrumbList, BlogPosting), Open Graph and Twitter tags, `/sitemap.xml`, `/robots.txt`, `/feed/`.

Every publish / update / delete regenerates the post pages, blog / tag / author
archives (with pagination), "similar posts", previous/next links, `sitemap.xml`,
`robots.txt` and the RSS feed. The whole site takes about 3 seconds.

## Deploying (VPS / Node host)
1. Copy the whole folder to the server (or push it to Git and clone).
2. `npm install --omit=dev`
3. Set environment variables and start:
   ```bash
   export PORT=3000
   export SITE_URL=https://agents.stars777.org   # your public domain (canonical/OG/sitemap)
   node server.js          # keep alive with pm2:  pm2 start server.js --name stars777
   ```
4. Put Nginx/Caddy in front for HTTPS (the session cookie is marked `Secure` over HTTPS).
5. **Back up `content/` and `site/wp-content/uploads/`** – that is all your data.

## Notes
- Static pages (homepage, game pages, etc.) are plain HTML in `site/`. Their content
  is not edited through the admin panel, but their SEO meta is (SEO → Static Pages).
- Contact Form 7 and site search were WordPress features and don't work on the
  static pages. Tawk.to chat and Google Analytics still work.
- `tools/import-wp.js` re-imports posts from the live WordPress site; it
  **overwrites** posts with the same ID, so only run it before you start editing here.
