/**
 * ESLint rule for the CSS inside Svelte `<style>` blocks (eslint-plugin-svelte does not expose declarations).
 *
 * Options: `{ colours?: boolean, fontFamily?: boolean, spacing?: boolean }`; each enables one check.
 * Reports every offending declaration on its own line.
 */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/;
const SPACING = /^(?:margin|padding|gap|row-gap|column-gap|line-height)(?:-[a-z-]+)?$/;
const DECLARATION = /([a-z-]+)\s*:\s*([^;{}]+)/gi;

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
    messages: {
      colour: 'Colour literals belong in theme/; use a var(--pw-*) role.',
      fontFamily: 'Use font-family: var(--pw-font) only.',
      spacing: 'Widgets set no margin, padding, gap or line-height; spacing belongs to the kit and the theme density tokens.',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    return {
      SvelteStyleElement(node) {
        const sourceCode = context.sourceCode;
        const text = sourceCode.getText(node);
        for (const match of text.matchAll(DECLARATION)) {
          const [, property = '', value = ''] = match;
          let messageId;
          if (options.colours && COLOUR.test(value)) messageId = 'colour';
          else if (options.fontFamily && property === 'font-family' && value.trim() !== 'var(--pw-font)') messageId = 'fontFamily';
          else if (options.spacing && SPACING.test(property)) messageId = 'spacing';
          if (!messageId) continue;
          const start = sourceCode.getLocFromIndex(node.range[0] + (match.index ?? 0));
          context.report({ loc: { start, end: start }, messageId });
        }
      },
    };
  },
};

export default { rules: { 'style-declarations': styleDeclarations } };
