/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.js",
    "./views/**/*.{js,ts,jsx,tsx,ejs}",
    "./public/**/*.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  safelist: [
    'grid',
    'grid-cols-12',
    'col-span-1',
    'col-span-2',
    'col-span-4',
    'gap-4',
    'cursor-move',
    'min-h-full',
    'h-screen',
    'flex-1',
    'overflow-y-auto',
    'overflow-hidden',
    'w-10',
    'h-10',
    'dragging',
    'drag-over',
    'drop-zone',
    'album-row'
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}