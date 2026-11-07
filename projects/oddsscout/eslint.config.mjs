import js from '@eslint/js';
import globals from 'globals';
export default [
 {ignores:['dist/**','node_modules/**','history/**','test-evidence/**','OddsScout-*.html','tests/**','public/lib/demo.mjs','public/vendor/**']},
 js.configs.recommended,
 {files:['**/*.mjs','netlify/edge-functions/**/*.js'],languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:{...globals.browser,...globals.node,Netlify:'readonly'}},rules:{'no-unused-vars':['warn',{argsIgnorePattern:'^_',caughtErrors:'none'}],'no-constant-condition':'error','no-control-regex':'off'}}
];
