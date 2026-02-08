/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./app.js"],
  theme: {
    extend: {
      boxShadow: {
        soft: "0 1px 0 rgba(15,23,42,0.04), 0 18px 60px rgba(15,23,42,0.12)"
      }
    }
  },
  plugins: []
};

