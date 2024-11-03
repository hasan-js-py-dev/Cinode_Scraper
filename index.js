const fs = require("fs");
const csv = require("csv-parser");
const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

let companies = [];

// Read the CSV file and store the companies
fs.createReadStream("companies.csv")
  .pipe(csv())
  .on("data", (row) => {
    companies.push(row);
  })
  .on("end", () => {
    console.log("CSV file successfully processed");
    startScraping();
  });

// Function to check if the user is logged in
async function isLoggedIn(page) {
  // Check for an element that only appears when logged in
  const loggedIn = await page.evaluate(() => {
    // Replace this selector with an actual selector that appears only when logged in
    return document.querySelector("selector-for-logged-in-element") !== null;
  });
  return loggedIn;
}

// Function to load cookies
async function loadCookies(page) {
  const cookiesPath = "cookies.json";
  if (fs.existsSync(cookiesPath)) {
    const cookiesString = fs.readFileSync(cookiesPath);
    const cookies = JSON.parse(cookiesString);
    await page.setCookie(...cookies);
    return true;
  }
  return false;
}

// Login function
async function login(page) {
  console.log("Starting login process...");

  // Navigate to the login page if not already there
  const loginUrl = "https://app.cinode.com/login"; // Replace with the actual login URL if different
  if (page.url() !== loginUrl) {
    await page.goto(loginUrl, { waitUntil: "networkidle2" });
  }

  // Wait for the email input field and enter the email
  await page.waitForSelector("input#email", { timeout: 5000 });
  await page.type("input#email", "seewaqas@gmail.com"); // Replace with your email

  // Click the login button after entering email
  // The login button is within a span with text 'Log in'
  await page.waitForXPath("//span[contains(text(), 'Log in')]", {
    timeout: 5000,
  });
  const loginButtonAfterEmail = await page.$x(
    "//span[contains(text(), 'Log in')]"
  );
  if (loginButtonAfterEmail.length > 0) {
    await loginButtonAfterEmail[0].click();
  } else {
    throw new Error("Login button after email not found");
  }

  // Wait for the password input field and enter the password
  await page.waitForSelector("input#current-password", { timeout: 5000 });
  await page.type("input#current-password", "Rp5fF@XpYU52g6a"); // Replace with your password

  // Click the login button after entering password
  await page.waitForXPath("//span[contains(text(), 'Log in')]", {
    timeout: 5000,
  });
  const loginButtonAfterPassword = await page.$x(
    "//span[contains(text(), 'Log in')]"
  );
  if (loginButtonAfterPassword.length > 0) {
    await loginButtonAfterPassword[0].click();
  } else {
    throw new Error("Login button after password not found");
  }

  // Wait for navigation after login
  await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 });

  // Verify that login was successful
  const loggedIn = await isLoggedIn(page);
  if (loggedIn) {
    console.log("Logged in successfully.");
    // Save cookies
    const cookies = await page.cookies();
    fs.writeFileSync("cookies.json", JSON.stringify(cookies, null, 2));
  } else {
    throw new Error("Login failed. Please check your credentials.");
  }
}

// Function to scrape data for a company
async function scrapeCompany(page, company) {
  try {
    console.log(`Processing company: ${company["Company Name"]}`);

    // Navigate to the company's page
    await page.goto(company["Search URL"], { waitUntil: "networkidle2" });

    // Check if login is required by looking for the login form
    if ((await page.$("input#email")) !== null) {
      console.log("Login required. Attempting to log in...");
      await login(page);

      // After logging in, navigate to the company page again
      await page.goto(company["Search URL"], { waitUntil: "networkidle2" });
    }

    // Wait for the element that indicates the page has loaded
    // For example, wait for 'app-company-user'
    await page.waitForSelector("app-company-user", { timeout: 10000 });

    // Get the page content
    const content = await page.content();
    const $ = cheerio.load(content);

    // Extract the contact name and email
    let contactName = "";
    let contactEmail = "";

    $("app-company-user").each((index, element) => {
      // Extract the name
      const nameElement = $(element).find("div.user__text cui-string").first();
      contactName = nameElement.text().trim();

      // Extract the email
      const emailElement = $(element)
        .find("div.user__text cui-string")
        .eq(1)
        .find('a[href^="mailto:"]');
      contactEmail = emailElement.attr("href")
        ? emailElement.attr("href").replace("mailto:", "").trim()
        : "";
    });

    console.log(`Contact Name: ${contactName}`);
    console.log(`Contact Email: ${contactEmail}`);

    return {
      "Company Name": company["Company Name"],
      "Search URL": company["Search URL"],
      "Contact Name": contactName,
      "Contact Email": contactEmail,
    };
  } catch (error) {
    console.error(`Error scraping ${company["Company Name"]}:`, error);
    return null;
  }
}

// Main function to start scraping
async function startScraping() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  // Load cookies if available
  const cookiesLoaded = await loadCookies(page);

  // Navigate to the first company's URL to check if we are logged in
  await page.goto(companies[0]["Search URL"], { waitUntil: "networkidle2" });

  if ((await page.$("input#email")) !== null) {
    console.log("Not logged in. Logging in now...");
    await login(page);

    // After logging in, navigate to the first company page again
    await page.goto(companies[0]["Search URL"], { waitUntil: "networkidle2" });
  } else {
    console.log("Already logged in.");
  }

  const scrapedData = [];

  for (let company of companies) {
    try {
      const data = await scrapeCompany(page, company);
      if (data) {
        scrapedData.push(data);
      }
    } catch (error) {
      console.error(
        `Error processing company ${company["Company Name"]}:`,
        error
      );
    }
  }

  await browser.close();

  // Write the scraped data to a CSV file
  writeResultsToCSV(scrapedData);
}

// Function to write results to a CSV file
function writeResultsToCSV(data) {
  const csvWriter = createCsvWriter({
    path: "scraped_companies.csv",
    header: [
      { id: "Company Name", title: "Company Name" },
      { id: "Search URL", title: "Search URL" },
      { id: "Contact Name", title: "Contact Name" },
      { id: "Contact Email", title: "Contact Email" },
    ],
  });

  csvWriter
    .writeRecords(data)
    .then(() =>
      console.log("Data successfully written to scraped_companies.csv")
    )
    .catch((error) => console.error("Error writing to CSV file:", error));
}
