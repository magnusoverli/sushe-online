/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.js',
    './views/**/*.{js,ts,jsx,tsx,ejs}',
    './public/**/*.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './public/**/*.js',
    './templates.js',
  ],
  safelist: [
    // Album display classes
    'album-grid',
    'album-cover-container',
    'album-cover',
    'album-cover-placeholder',
    'album-row',
    'position-display',

    // Drag and drop classes
    'dragging',
    'drag-active',
    'drop-target',

    // Editable cell classes
    'comment-cell',
    'genre-cell',
    'genre-1-cell',
    'genre-2-cell',
    'country-cell',

    // Common utility classes
    'hidden',
    'relative',
    'absolute',
    'fixed',
    'sticky',
    'inset-0',
    'top-0',
    'top-2',
    'right-2',
    'z-10',

    // Flexbox/Grid
    'flex',
    'flex-col',
    'flex-1',
    'items-center',
    'justify-center',
    'gap-2',
    'gap-4',
    'grid',
    'grid-cols-2',
    'lg:grid-cols-4',
    'col-span-full',

    // Spacing
    'p-1',
    'p-2',
    'p-4',
    'p-6',
    'px-2',
    'px-3',
    'px-4',
    'py-1',
    'py-2',
    'py-3',
    'mt-1',
    'mt-2',
    'mt-6',
    'mt-20',
    'mb-2',
    'mb-3',
    'pt-6',
    'space-y-1',
    'space-y-2',

    // Sizing
    'w-12',
    'h-12',
    'w-64',
    'w-full',
    'h-screen',
    'min-h-full',
    'min-w-0',
    'max-w-4xl',
    'max-h-[90vh]',

    // Typography
    'text-xs',
    'text-sm',
    'text-lg',
    'text-xl',
    'text-2xl',
    'text-3xl',
    'text-center',
    'text-white',
    'text-gray-300',
    'text-gray-400',
    'text-gray-500',
    'text-gray-600',
    'text-red-500',
    'text-red-600',
    'font-medium',
    'font-semibold',
    'font-bold',
    'uppercase',
    'tracking-wider',
    'italic',
    'truncate',
    'line-clamp-2',

    // Backgrounds
    'bg-black',
    'bg-gray-700',
    'bg-gray-800',
    'bg-gray-800/30',
    'bg-gray-900',
    'bg-gray-900/50',
    'bg-red-600',
    'bg-opacity-50',
    'backdrop-blur-sm',

    // Borders
    'border',
    'border-b',
    'border-r',
    'border-t',
    'border-gray-700',
    'border-gray-800',
    'border-b-2',
    'rounded',
    'rounded-full',

    // Hover states
    'hover:text-gray-100',
    'hover:text-red-400',
    'hover:bg-gray-700',
    'hover:bg-gray-800/30',
    'hover:bg-red-700',

    // Transitions
    'transition',
    'transition-colors',
    'transition-transform',
    'duration-200',
    'transform',
    'scale-105',
    'group',
    'group-hover:scale-105',

    // Animations
    'animate-spin',

    // Focus/Form
    'focus:outline-none',
    'focus:border-red-600',
    'resize-none',
    'cursor-pointer',
    'cursor-move',

    // Layout
    'overflow-hidden',
    'overflow-y-auto',
    'object-cover',
    'shadow-lg',

    // Custom classes
    'metal-title',
    'glow-red',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
