import tls from 'tls';

// What a TLS server is actually presenting, for when Node has refused it.
//
// "unable to get local issuer certificate" is the same message whether the
// server sent an incomplete chain or sent a complete one signed by a CA that
// nothing trusts, and the two have entirely different fixes — one is a
// misconfigured server, the other is a certificate that has to be reissued. So
// rather than guess, this reads the chain back and reports it.

// Let's Encrypt's staging CAs are named like a joke precisely so that nobody
// mistakes one for the real thing: Bogus Broccoli, Pretend Pear, Happy Hacker,
// Artificial Amaranth, Yearning Yucca. Their roots are deliberately in no trust
// store on earth, so a certificate from them fails verification everywhere and
// always will. Hitting this means whatever issued the certificate was pointed
// at the staging environment — usually a leftover --staging or --test-cert.
const STAGING_CA =
  /\(STAGING\)|bogus broccoli|pretend pear|happy hacker|artificial amaranth|yearning yucca|fake le/i;

// A certificate the holder signed themselves: subject and issuer match and
// there is nothing above it. Trusted by nothing until it is installed as a
// trust anchor somewhere.
export function isSelfSigned(chain) {
  return chain.length === 1 && chain[0].subject === chain[0].issuer;
}

export function looksLikeStaging(chain) {
  return chain.some((link) => STAGING_CA.test(link.issuer) || STAGING_CA.test(link.subject));
}

// Whether the server stopped at its own certificate without sending the
// intermediate above it. Browsers hide this by fetching or remembering
// intermediates; Node does not, which is why mail works in a mail client and
// not here.
export function chainIsIncomplete(chain) {
  if (chain.length !== 1) return false;
  return chain[0].subject !== chain[0].issuer;
}

// One line each, outermost last, in the order the server sent them.
//
// Verification is deliberately off. This connection sends nothing and carries
// nothing — its only purpose is to read back the certificate that was already
// rejected, which cannot be done over a connection that refuses to complete.
// It must never be the shape of the transport that sends mail: there, turning
// this off would hand the SMTP password to anyone able to sit in the middle.
export function readCertChain({ host, port, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs },
      () => {
        const chain = [];
        const seen = new Set();
        let cert = socket.getPeerCertificate(true);
        // The chain is a linked list through issuerCertificate, and a root
        // points at itself — so without the fingerprint check this loops for
        // ever on any self-signed anchor.
        while (cert && Object.keys(cert).length > 0 && !seen.has(cert.fingerprint256)) {
          seen.add(cert.fingerprint256);
          chain.push({
            subject: describeName(cert.subject),
            issuer: describeName(cert.issuer),
            validTo: cert.valid_to || null,
          });
          cert = cert.issuerCertificate;
        }
        socket.end();
        resolve(chain);
      }
    );
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error(`No answer from ${host}:${port} within ${timeoutMs / 1000}s`));
    });
    socket.on('error', reject);
  });
}

function describeName(name) {
  if (!name) return '(none)';
  // CN is the name a person recognises; O is what identifies a CA when the
  // common name is a code. Both, when they differ.
  const parts = [name.O, name.CN].filter((v, i, all) => v && all.indexOf(v) === i);
  return parts.join(' — ') || '(none)';
}

// The chain, read and interpreted, as lines ready to print. Returns null when
// the connection could not be made at all, since then there is nothing to say
// about a certificate.
export async function describeCertChain({ host, port }) {
  let chain;
  try {
    chain = await readCertChain({ host, port });
  } catch {
    return null;
  }
  if (!chain.length) return null;

  const lines = chain.map((link, i) => `    ${i}  ${link.subject}\n       issued by ${link.issuer}`);

  let verdict = null;
  if (looksLikeStaging(chain)) {
    verdict =
      'This is a Let’s Encrypt STAGING certificate. Staging roots are trusted by nothing, by design, so this ' +
      'will never verify anywhere — every client talking to this server fails the same way, not just Taxify. ' +
      'Reissue it against production: drop --staging / --test-cert (certbot keeps the choice in ' +
      '/etc/letsencrypt/renewal/<name>.conf, so check the server line there too), then force a renewal and ' +
      'restart the mail server. Do not add the staging root to this machine’s trust store.';
  } else if (isSelfSigned(chain)) {
    verdict =
      'The certificate is self-signed. Either replace it with one from a real CA, or point NODE_EXTRA_CA_CERTS at ' +
      'it so this server trusts it deliberately.';
  } else if (chainIsIncomplete(chain)) {
    verdict =
      'Only the server’s own certificate was sent, with no intermediate above it. That is a mail server ' +
      'configuration fix — point it at the full chain (fullchain.pem rather than cert.pem, for Let’s Encrypt).';
  } else {
    // A complete chain to a CA this machine does not trust: a private or
    // internal CA, or one whose root is not in the system bundle. Not guessed
    // at, because the chain above says who issued it and that is the fact
    // worth acting on — but saying nothing at all reads as the check having
    // given up.
    verdict =
      'The chain is complete, so the root above is simply not trusted by this machine. If that CA is one of yours, ' +
      'point NODE_EXTRA_CA_CERTS at its root certificate. If it is meant to be a public CA, the certificate needs ' +
      'reissuing by one that is.';
  }

  return { chain, lines, verdict };
}
