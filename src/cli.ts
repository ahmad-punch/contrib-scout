import { run } from "./run.ts";

run(process.argv).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(
      `contrib-scout crashed unexpectedly. Please report this with the output below.\n${detail}\n`,
    );
    process.exitCode = 1;
  },
);
