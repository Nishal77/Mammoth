import chalk from "chalk";

const prefix = chalk.bold.white("[MAMMOTH]");

export const logger = {
  info: (msg: string) => console.log(`${prefix} ${chalk.cyan(msg)}`),
  success: (msg: string) => console.log(`${prefix} ${chalk.green(msg)}`),
  warn: (msg: string) => console.log(`${prefix} ${chalk.yellow(msg)}`),
  error: (msg: string) => console.error(`${prefix} ${chalk.red(msg)}`),
  dim: (msg: string) => console.log(chalk.dim(msg)),
  blank: () => console.log(),
  header: (msg: string) => {
    console.log();
    console.log(chalk.bold.white(msg));
    console.log(chalk.dim("─".repeat(msg.length)));
  },
};
