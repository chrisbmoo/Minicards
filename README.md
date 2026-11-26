# minicards.com.au

Static copy of the Minicards Melbourne website (previously WordPress + Elementor on SiteGround),
with a small card manager at `/admin` so the client can update the minicards himself.
No WordPress and no plugins to update.

## Hosting (Cloudflare Pages + GitHub)

1. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git** → pick this repo.
   - Framework preset: **None**
   - Build command: `node build.js`
   - Build output directory: `dist`
2. Check the `*.pages.dev` preview, then add `minicards.com.au` and `www.minicards.com.au`
   under the project's **Custom domains** tab.

Every push to `main` (including every **Publish** in the card manager) rebuilds and redeploys
the site, usually within one to two minutes.

`build.js` copies the site into `dist/` and generates the Cards page, each card's page and
`sitemap.xml` from `cards.json`. To preview locally: `node build.js`, then serve `dist/`
(e.g. `cd dist && python3 -m http.server`).

## Card manager (/admin)

The client signs in at **minicards.com.au/admin** with his email address (Cloudflare Access
emails him a one-time code). He can add cards, upload front and back images, choose the
category tabs, reorder, hide and delete cards, then **Publish**. Publishing saves
`cards.json` and any new images to this repo as a commit ("Cards updated via admin by …"),
so every change is in the history and can be rolled back.

### One-time setup

Do this after the site is live on its custom domain (the domain's DNS must be on Cloudflare).

**1. GitHub token** – github.com → Settings → Developer settings → Personal access tokens →
**Fine-grained tokens → Generate new token**
- Repository access: **Only select repositories** → `chrisbmoo/minicards`
- Permissions → Repository permissions → **Contents: Read and write**
- Copy the token. Note its expiry date and renew it before then.

**2. Cloudflare Access** – Cloudflare dashboard → **Zero Trust** (choose a team name, e.g.
`moomedia`, and the Free plan, which covers up to 50 users)
- Settings → Authentication → Login methods → **Add new → One-time PIN**
- Access → Applications → **Add an application → Self-hosted**
  - Name: `Minicards card manager`
  - Public hostnames: `www.minicards.com.au` with path `admin`, and `minicards.com.au` with path `admin`
  - Login method: One-time PIN
  - Policy: **Allow**, Include → **Emails** → the client's email address and yours
  - Session duration: 1 week is reasonable
- Open the saved application and copy its **Application Audience (AUD) Tag**.

**3. Pages variables** – Workers & Pages → the minicards project → **Settings → Variables and
secrets** → Production:

| Name | Value |
|---|---|
| `GITHUB_TOKEN` (type: Secret) | the token from step 1 |
| `GITHUB_REPO` | `chrisbmoo/minicards` |
| `GITHUB_BRANCH` | `main` |
| `ACCESS_TEAM_DOMAIN` | `<team-name>.cloudflareaccess.com` |
| `ACCESS_AUD` | the AUD tag from step 2 |

Then **Deployments → Retry deployment** (or push any commit) so the variables take effect.

**4. Test** – open minicards.com.au/admin in a private window, sign in with the emailed code,
hide a card, publish, and check the Cards page after two minutes. Unhide and publish again.

To give someone else access, add their email to the Access policy. To remove access, take it out.

### How it's secured

- `/admin` is behind Cloudflare Access; only the emails in the policy can sign in.
- The save endpoint (`functions/admin/api/cards.js`) checks the Access login itself on every
  request and refuses anything without a valid one, so it stays locked even if Access is
  misconfigured or the page is opened on the `*.pages.dev` address.
- The GitHub token can only change this one repository, and the endpoint only writes
  `cards.json` and images under `wp-content/uploads/cards/`.

## What's where

| What | Where |
|---|---|
| Card list (names, images, tabs, order, hidden) | `cards.json` – edited by the card manager |
| Card manager page / save endpoint | `admin/index.html` / `functions/admin/api/cards.js` |
| Cards page and card page layouts | `_templates/` (used by `build.js`) |
| Home page | `index.html` |
| Other pages | `<page-name>/index.html` (same URLs as the old site) |
| Category pages | `service_type/<category>/index.html` |
| Images & uploads | `wp-content/uploads/` (new card images: `wp-content/uploads/cards/`) |
| Theme / Elementor styles and scripts | `wp-content/`, `wp-includes/` (copied as-is from WordPress) |
| Search box & contact form | `assets/static.js` |
| Page not found | `404.html` |
| Old-URL redirects / headers | `_redirects` / `_headers` |

The header, footer and menu are repeated in every page and template. To change a menu item,
find-and-replace it across all `index.html` files and `_templates/`.

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
