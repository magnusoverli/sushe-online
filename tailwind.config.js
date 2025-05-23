/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./views/**/*.{ejs,html}",
    "./public/**/*.{js,html}",
    "./index.js" // Include your server file to catch inline HTML
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}