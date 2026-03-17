#!/usr/bin/env node
import meow from "meow";

meow(
  `
  Usage
    $ catching-jit-tests-vitest <input>

  Options
    --help     Show help
    --version  Show version
  `,
  { importMeta: import.meta },
);
