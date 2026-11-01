import { ruleTester } from './rule-tester.mjs';
import rule from './block-multiline.mjs';

const error = { messageId: 'multiline' };

ruleTester.run('block-multiline', rule, {
  valid: [
    { name: 'body on its own lines', code: 'if (a) {\n  run();\n}' },
    { name: 'an empty block is left alone', code: 'try {\n  run();\n} catch {}' },
    { name: 'function bodies are not targeted', code: 'const f = () => { return 1; };' },
    { name: 'else body on its own lines', code: 'if (a) {\n  run();\n} else {\n  stop();\n}' },
  ],
  invalid: [
    {
      name: 'inline if body',
      code: 'if (a) { run(); }',
      output: 'if (a) {\n run(); \n}',
      errors: [error],
    },
    {
      name: 'inline else body',
      code: 'if (a) {\n  run();\n} else { stop(); }',
      output: 'if (a) {\n  run();\n} else {\n stop(); \n}',
      errors: [error],
    },
    {
      name: 'loops, try and catch',
      code: 'for (const x of xs) { use(x); }\ntry { run(); } catch (e) { log(e); }',
      output: 'for (const x of xs) {\n use(x); \n}\ntry {\n run(); \n} catch (e) {\n log(e); \n}',
      errors: [error, error, error],
    },
  ],
});
