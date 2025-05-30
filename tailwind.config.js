/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.js",
    "./views/**/*.{js,ts,jsx,tsx,ejs}",
    "./public/**/*.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./public/**/*.js",
    "./templates.js"
  ],
  safelist: [
    'max-w-2xl',
    'w-24',
    'h-24',
    'object-cover',
    'hidden',
    'text-red-500',
    'absolute',
    'top-2',
    'right-2',
    'bg-red-600',
    'text-white',
    'text-xs',
    'px-2',
    'py-1',
    'rounded',
    'z-10',
    'font-semibold',
    'relative',
    'album-grid',
    'album-grid',
    'album-cover-container',
    'album-cover',
    'album-cover-placeholder',
    'aspect-ratio',
    'object-fit',
    'gap-4',
    'px-4',
    'py-3',
    'album-grid',
    'album-cover',
    'cursor-pointer',
    'hover:text-gray-100',
    'resize-none',
    'focus:outline-none',
    'focus:border-red-600',
    'border',
    'border-gray-700',
    'p-2',
    'comment-cell',
    'genre-cell',
    'genre-1-cell', 
    'genre-2-cell',
    'p-1',
    'w-full',
    'grid',
    'grid-cols-[50px_60px_1fr_0.8fr_0.6fr_0.6fr_1.2fr]',
    'col-span-full',
    'gap-4',
    'cursor-move',
    'min-h-full',
    'h-screen',
    'flex',
    'flex-col',
    'flex-1',
    'items-center',
    'justify-center',
    'space-y-1',
    'min-w-0',
    'truncate',
    'line-clamp-2',
    'italic',
    'overflow-y-auto',
    'overflow-hidden',
    'w-12',
    'h-12',
    'w-full',
    'shadow-lg',
    'text-white',
    'text-gray-300',
    'text-gray-400',
    'text-gray-500',
    'text-gray-600',
    'text-red-500',
    'text-xs',
    'text-sm',
    'text-lg',
    'font-medium',
    'font-bold',
    'bg-gray-800/30',
    'hover:bg-gray-800/30',
    'transition-colors',
    'dragging',
    'drag-over',
    'drag-active',
    'drag-placeholder',
    'drop-zone',
    'album-row',
    'px-4',
    'py-3',
    'border-b',
    'border-gray-800',
    'sticky',
    'top-0',
    'bg-black',
    'z-10',
    'relative',
    'text-center',
    'uppercase',
    'tracking-wider',
    'rounded',
    'bg-gray-800',
    'bg-gray-900',
    'bg-gray-900/50',
    'backdrop-blur-sm',
    'p-6',
    'mt-20',
    'mb-2',
    'space-y-1',
    'border-t',
    'mt-6',
    'pt-6',
    'mb-3',
    'mt-1',
    'mt-2',
    'bg-gray-700',
    'hover:bg-gray-700',
    'hover:bg-red-700',
    'px-3',
    'py-2',
    'transition',
    'duration-200',
    'text-2xl',
    'text-3xl',
    'text-xl',
    'glow-red',
    'metal-title',
    'hover:text-red-400',
    'w-64',
    'border-r',
    'p-4',
    'aspect-square',
    'grid-cols-2',
    'md:grid-cols-3', 
    'lg:grid-cols-4',
    'group',
    'group-hover:scale-105',
    'transition-transform',
    'max-w-4xl',
    'max-h-[90vh]',
    'animate-spin',
    'rounded-full',
    'border-b-2',
    'object-cover',
    'space-y-2',
    'gap-2',
    'py-12',
    'flex-1',
    'overflow-y-auto',
    'overflow-hidden',
    'fixed',
    'inset-0',
    'bg-opacity-50',
    'transform',
    'scale-105',
    'grid-cols-[50px_60px_1fr_0.8fr_0.5fr_0.6fr_0.6fr_1.2fr]',
    'country-cell',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}