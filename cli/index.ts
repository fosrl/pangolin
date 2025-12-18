#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { setAdminCredentials } from "@cli/commands/setAdminCredentials";
import { resetUserSecurityKeys } from "@cli/commands/resetUserSecurityKeys";
import { clearExitNodes } from "./commands/clearExitNodes";
import { rotateServerSecret } from "./commands/rotateServerSecret";

yargs(hideBin(process.argv))
    .scriptName("pangctl")
    .command(setAdminCredentials)
    .command(resetUserSecurityKeys)
    .command(clearExitNodes)
    .command(rotateServerSecret)
    .demandCommand()
    .help().argv;
