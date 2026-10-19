export async function startCertificateManager() {
    // No-op: ACME certificate generation/management is only available in
    // builds that include the private/enterprise feature set.
}

export async function stopCertificateManager() {
    // No-op counterpart to startCertificateManager.
}
