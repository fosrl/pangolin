#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { setAdminCredentials } from "@cli/commands/setAdminCredentials";
import { resetUserSecurityKeys } from "@cli/commands/resetUserSecurityKeys";
import { clearExitNodes } from "./commands/clearExitNodes";
import { rotateServerSecret } from "./commands/rotateServerSecret";
import { clearLicenseKeys } from "./commands/clearLicenseKeys";
import { deleteClient } from "./commands/deleteClient";
import { generateOrgCaKeys } from "./commands/generateOrgCaKeys";
import { clearCertificates } from "./commands/clearCertificates";
import { disableUser2fa } from "./commands/disableUser2fa";
import { setServerAdmin } from "./commands/setServerAdmin";

yargs(hideBin(process.argv))
    .scriptName("pangctl")
    .command(setAdminCredentials)
    .command(resetUserSecurityKeys)
    .command(clearExitNodes)
    .command(rotateServerSecret)
    .command(clearLicenseKeys)
    .command(deleteClient)
    .command(generateOrgCaKeys)
    .command(clearCertificates)
    .command(disableUser2fa)
    .command(setServerAdmin)
    .demandCommand()
    .help().argv;
