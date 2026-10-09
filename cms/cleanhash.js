/**
 * Clean section links: clicking a menu link like "/#About" scrolls to the
 * section without adding "#About" to the address bar, and arriving from
 * another page with a hash scrolls to the section and then removes the hash.
 *
 * Injected before </body> of every HTML page between <!--cms:cleanhash-->
 * markers (same mechanism as the social bar), so it can be replaced cleanly.
 */
const fs = require('fs');
const social = require('./social');

const JS = `(function(){
var L=location,H=history,R=H.replaceState,P=H.pushState;
function find(id){if(!id||/elementor-action/i.test(id))return null;try{id=decodeURIComponent(id);}catch(e){}return document.getElementById(id);}
function bare(){return L.pathname+L.search;}
function same(u){return u.origin===L.origin&&u.pathname===L.pathname&&u.search===L.search;}
H.pushState=function(s,t,u){try{var x=new URL(u,L.href);if(x.hash&&same(x)&&find(x.hash.slice(1)))return R.call(H,s,t,bare());}catch(e){}return P.apply(H,arguments);};
window.addEventListener("hashchange",function(){if(find(L.hash.slice(1)))R.call(H,H.state,"",bare());});
document.addEventListener("click",function(e){
if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
var a=e.target.closest&&e.target.closest("a[href*='#']");if(!a||a.target==="_blank")return;
var u;try{u=new URL(a.href);}catch(x){return;}
if(!same(u))return;var el=find(u.hash.slice(1));if(!el)return;
e.preventDefault();el.scrollIntoView({behavior:"smooth",block:"start"});
});
var t=find(L.hash.slice(1));
if(t){var go=function(){var k=window.kadence;if(k&&k.scrollToElement)k.scrollToElement(t,false);else t.scrollIntoView({block:"start"});R.call(H,H.state,"",bare());};
if(document.readyState==="complete")setTimeout(go,0);else window.addEventListener("load",function(){setTimeout(go,0);});}
})();`;

const BLOCK = `<!--cms:cleanhash--><script>${JS}</script><!--/cms:cleanhash-->`;
const RE = /\n?<!--cms:cleanhash-->[\s\S]*?<!--\/cms:cleanhash-->\n?/g;

/** Remove any old copy and insert the current script before </body>. */
function inject(html) {
  const out = String(html).replace(RE, '');
  const i = out.lastIndexOf('</body>');
  if (i === -1) return out;
  return `${out.slice(0, i)}\n${BLOCK}\n${out.slice(i)}`;
}

/** Apply to every HTML page in the site. Returns number of files changed. */
function applyAll() {
  let changed = 0;
  for (const f of social.htmlFiles()) {
    const html = fs.readFileSync(f, 'utf8');
    const out = inject(html);
    if (out !== html) { fs.writeFileSync(f, out); changed++; }
  }
  return changed;
}

module.exports = { inject, applyAll };
