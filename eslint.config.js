import globals from "globals";

export default [{
  files: ["src/**/*.js"],
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    globals: {
      ...globals.browser,
      chrome: "readonly"
    }
  },
  rules: {
    "no-undef": "error"
  }
}];
