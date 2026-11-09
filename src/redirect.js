// Ported from veryshort's app.ts (buildRedirectUrl): merges the incoming query
// string into the stored destination, ahead of any #fragment. Pure + total
// except for non-HTTP(S) destinations, which throw.
export function buildRedirectUrl(destination, originalUrl) {
    const parsedDestination = new URL(destination);

    if (parsedDestination.protocol !== "http:" && parsedDestination.protocol !== "https:") {
        throw new Error("Redirect destination must use HTTP or HTTPS");
    }

    const queryStart = originalUrl.indexOf("?");
    if (queryStart === -1 || queryStart === originalUrl.length - 1) {
        return destination;
    }

    const incomingQuery = originalUrl.slice(queryStart + 1);
    const fragmentStart = destination.indexOf("#");
    const destinationWithoutFragment =
        fragmentStart === -1 ? destination : destination.slice(0, fragmentStart);
    const fragment = fragmentStart === -1 ? "" : destination.slice(fragmentStart);

    let separator = "?";
    if (destinationWithoutFragment.includes("?")) {
        separator =
            destinationWithoutFragment.endsWith("?") || destinationWithoutFragment.endsWith("&")
                ? ""
                : "&";
    }

    return `${destinationWithoutFragment}${separator}${incomingQuery}${fragment}`;
}

