/** Tailwind config dedicated to the standalone /music immersive page.
 *  Generates a static `public/music/tw.css` at build time so the page no
 *  longer needs the runtime Play CDN (which causes a FOUC / flash). */
module.exports = {
  content: [
    './public/music/index.html',
    './public/music/script.js',
    './pages/music.js'
  ],
  theme: {
    extend: {}
  },
  plugins: []
}
