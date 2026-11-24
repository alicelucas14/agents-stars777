/**
 * Content written by staff accounts: no scripts.
 *
 * Post and page bodies are published as raw HTML on the public site, so a script in a body would run for
 * every visitor of that page. Only the super admin may publish such things. For everyone else the server
 * removes, whatever the editor or an API call sent:
 *   - <script>, <base>, <object>, <embed>, <applet> and <meta> elements (meta http-equiv="refresh" redirects),
 *   - every inline event handler (onclick, onerror, onload …) and iframe srcdoc,
 *   - javascript:, vbscript: and data:text/html links (also hidden with spaces, tabs or character codes),
 *   - data: addresses in links, frames and forms (data:image/svg+xml stays fine on <img>),
 *   - SVG <animate>/<set> that rewrite a link address.
 * Normal markup (images, links, iframes for embeds, styles, tables …) is left alone, and when nothing needs
 * removing the text is returned exactly as it was sent – not re-written by the HTML parser.
 */
const cheerio = require('cheerio');

const BAD_TAGS = 'script, base, object, embed, applet, meta';
// the browser ignores spaces, tabs, line breaks and control characters inside a URL scheme ("java\tscript:")
const squash = (v) => String(v).replace(new RegExp("[" + [[0,0x20],[0x7f,0x9f],[0x200b,0x200f],[0x2028,0x2029],[0xfeff,0xfeff]].map(([a,b]) => String.fromCharCode(a) + "-" + String.fromCharCode(b)).join("") + "]+", "g"), "").toLowerCase();
const SCRIPT_URL = /^(?:javascript|vbscript|livescript|mocha):|^data:(?:text\/html|text\/javascript|application\/(?:xhtml\+xml|xml|javascript|x-javascript))/;
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster', 'background', 'codebase', 'cite', 'longdesc', 'ping']);
const NO_DATA_URL = { a: ['href'], area: ['href'], iframe: ['src'], frame: ['src'], form: ['action'], button: ['formaction'], input: ['formaction'], link: ['href'] };

/** { html, removed, what } – `removed` counts the things taken out, `what` names the kinds (for the message to the writer). */
function stripScripts(html) {
  const input = typeof html === 'string' ? html : '';
  if (!input) return { html: input, removed: 0, what: [] };
  const $ = cheerio.load(input, null, false); // a fragment, not a whole page
  const found = [];

  $(BAD_TAGS).each((_, el) => { found.push(`<${el.tagName}> element`); $(el).remove(); });
  // SVG keeps attributeName in mixed case, so look at every attribute name regardless of case
  $('animate, set').each((_, el) => {
    const target = Object.entries(el.attribs || {}).find(([n]) => n.toLowerCase() === 'attributename');
    if (target && /href/i.test(target[1])) { found.push('animated link'); $(el).remove(); }
  });
  $('*').each((_, el) => {
    for (const [name, value] of Object.entries(el.attribs || {})) {
      const v = squash(value);
      if (/^on/i.test(name)) { found.push('event handler'); $(el).removeAttr(name); }
      else if (name === 'srcdoc') { found.push('iframe srcdoc'); $(el).removeAttr(name); }
      else if (URL_ATTRS.has(name) && SCRIPT_URL.test(v)) { found.push('script link'); $(el).removeAttr(name); }
      else if ((NO_DATA_URL[el.tagName] || []).includes(name) && v.startsWith('data:')) { found.push('data: link'); $(el).removeAttr(name); }
    }
  });

  if (!found.length) return { html: input, removed: 0, what: [] };
  return { html: $.html(), removed: found.length, what: [...new Set(found)] };
}

module.exports = { stripScripts };
