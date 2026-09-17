/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cerina: {
          canvas: '#FAF8F5',
          surface: '#FFFFFF',
          'surface-subtle': '#F5F2EC',
          border: '#E8E4DA',
          'border-light': '#F0ECE3',
          primary: '#244F3B',
          'primary-hover': '#1B3D2E',
          'primary-light': '#EBF3EE',
          'primary-border': '#CDE0D4',
          text: '#18221E',
          'text-secondary': '#55635C',
          'text-muted': '#88978F',
          amber: '#FBF5EB',
          'amber-text': '#8C5921',
          'amber-border': '#EEDDC3',
          'amber-accent': '#D4882C',
          sky: '#EEF4F8',
          'sky-text': '#1D5A79',
          'sky-border': '#D2E4EF',
        },
      },
      fontFamily: {
        serif: ['Newsreader', 'Playfair Display', 'Lora', 'Georgia', 'serif'],
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
        script: ['Caveat', 'Playfair Display', 'cursive', 'serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [],
}

