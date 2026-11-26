# minicards.com.au

Static copy of the Minicards Melbourne website (previously WordPress + Elementor on SiteGround).
An exact copy of the live site's pages, images, styles and scripts, with no WordPress
behind it: no build step and no plugins to update.

## Hosting (Cloudflare + GitHub)

1. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git** → pick this repo.
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `/`
2. Check the `*.pages.dev` preview, then add `minicards.com.au` and `www.minicards.com.au`
   under the project's **Custom domains** tab.

Every push to `main` redeploys the site automatically.

## What's where

| What | Where |
|---|---|
| Home page | `index.html` |
| Other pages | `<page-name>/index.html` (same URLs as the old site) |
| Card pages | `cards/<card-name>/index.html` |
| Category pages | `service_type/<category>/index.html` |
| Images & uploads | `wp-content/uploads/` |
| Theme / Elementor styles and scripts | `wp-content/`, `wp-includes/` (copied as-is from WordPress) |
| Search box & contact form | `assets/static.js` |
| Page not found | `404.html` |
| Old-URL redirects | `_redirects` |

The header, footer and menu are repeated in every page. To change a menu item,
find-and-replace it across all `index.html` files.

## Contact form

The Contact page form sends through [Web3Forms](https://web3forms.com) (free, up to 250 messages/month).

Messages go to the email address the access key was created with. To change the
recipient, create a new access key at web3forms.com and replace `WEB3FORMS_KEY` at the
top of `assets/static.js`.

## Search

The search icon in the header sends visitors to a Google search of minicards.com.au
(WordPress's own search needs a server).

## Changes from the WordPress site

- WordPress's default "Sample Page" was dropped (redirects to the home page).
- The reCAPTCHA plugin was removed (it only worked with WordPress).
- WordPress-only head links (feeds, oEmbed, REST API, xmlrpc) were removed.
- Google Analytics tracking is unchanged.
