/**
 * Local ESLint rules for presentational values (spec 4.6).
 *
 * - `style-declarations`: CSS in Svelte `<style>` blocks, inline `style="..."` attributes and `style:prop`
 *   directives (eslint-plugin-svelte does not expose declarations). Options `{ colours, fontFamily, spacing }`.
 * - `no-colour-literals`: colour literals in strings, template literals and Svelte attribute values.
 *
 * Every offending declaration is reported on its own line.
 */
const COLOUR = /(?<![\w#&/.-])#[0-9a-fA-F]{3,8}(?![\w-])|(?<![\w-])(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/;
const SPACING = /^(?:grid-)?(?:margin|padding|gap|row-gap|column-gap|line-height)(?:-[a-z-]+)?$/;
const DECLARATION = /(?<![\w-])([a-z-]+)\s*:\s*([^;{}]+)/gi;

/** Blanks CSS comments but keeps every offset, so reported lines stay right. */
const blankComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));

/** Returns the rule violation of one declaration, if any. */
function violation(property, value, options) {
  if (options.colours && COLOUR.test(value)) return 'colour';
  if (options.fontFamily && property === 'font') return 'font';
  if (options.fontFamily && property === 'font-family' && value.trim() !== 'var(--pw-font)') return 'fontFamily';
  if (options.spacing && SPACING.test(property)) return 'spacing';
  return undefined;
}

const MESSAGES = {
  colour: 'Colour literals belong in theme/; use a var(--pw-*) role.',
  font: 'Use font-family: var(--pw-font) only; no font shorthand.',
  fontFamily: 'Use font-family: var(--pw-font) only.',
  spacing: 'Widgets set no margin, padding, gap or line-height; spacing belongs to the kit and the theme density tokens.',
};

/** @type {import('eslint').Rule.RuleModule} */
export const styleDeclarations = {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        properties: {
          colours: { type: 'boolean' },
          fontFamily: { type: 'boolean' },
          spacing: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: MESSAGES,
  },
  create(context) {
    const options = context.options[0] ?? {};
    const sourceCode = context.sourceCode;
    /** Scans CSS text that starts at `offset` in the file. */
    function scan(text, offset, opts) {
      for (const match of blankComments(text).matchAll(DECLARATION)) {
        const [, property = '', value = ''] = match;
        const messageId = violation(property, value, opts);
        if (!messageId) continue;
        const start = sourceCode.getLocFromIndex(offset + (match.index ?? 0));
        context.report({ loc: { start, end: start }, messageId });
      }
    }
    return {
      SvelteStyleElement(node) {
        scan(sourceCode.getText(node), node.range[0], options);
      },
      // Colours in attribute values are the job of no-colour-literals; avoid reporting them twice.
      SvelteAttribute(node) {
        if (node.key.name !== 'style') return;
        for (const part of node.value) {
          if (part.type === 'SvelteLiteral') scan(part.value, part.range[0], { ...options, colours: false });
        }
      },
      SvelteStyleDirective(node) {
        if (!options.spacing || !SPACING.test(node.key.name.name)) return;
        const start = sourceCode.getLocFromIndex(node.range[0]);
        context.report({ loc: { start, end: start }, messageId: 'spacing' });
      },
    };
  },
};

/** @type {import('eslint').Rule.RuleModule} */
export const noColourLiterals = {
  meta: { type: 'problem', schema: [], messages: { colour: MESSAGES.colour } },
  create(context) {
    const check = (node, text) => {
      if (COLOUR.test(text)) context.report({ node, messageId: 'colour' });
    };
    return {
      Literal: (node) => typeof node.value === 'string' && check(node, node.value),
      TemplateElement: (node) => check(node, node.value.raw),
      SvelteLiteral: (node) => check(node, node.value),
    };
  },
};

export default { rules: { 'style-declarations': styleDeclarations, 'no-colour-literals': noColourLiterals } };
