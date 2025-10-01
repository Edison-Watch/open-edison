/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./app/**/*.{js,ts,jsx,tsx}",
        "./node_modules/fumadocs-ui/dist/**/*.js",
    ],
    theme: {
        extend: {},
    },
    plugins: [
        require('@tailwindcss/typography'),
    ],
}
