
## Motivations

As a Computer Science Honors student in the Honors College, planning each of my semesters at Stony Brook is difficult. I wait for DegreeWork's clunky system to load, hop around tabs on the catalog, go back and forth in SOLAR, and jump over to Coursicle to find the best class sections for my next semester.

That's already painful, working with course requirements for three programs, and it's even more difficult to see if I can add a second major in Applied Math and a minor in Political Science, while still graduating in four years.

My goal is to create a system that can bring together all the tools I need to plan out my coursework for the degrees I want to pursue. As a result, Compass implements the degree-audit and What-If functionality of Ellucian Degree Works, the major-minor coursework requirements from the Office of the Registrar's catalog, class section search from SOLAR (PeopleSoft), and the easy-to-use UI of Coursicle to find a great schedule.

## Data Collection, Challenges, Agentic AI Tools

As a part of this project, two scrapers were built to retrieve data from Stony Brook's public-facing PeopleSoft systems, providing access to a course catalog (every course Stony Brook offers with pre-requisite information, course descriptions, and more), as well as class section list (sections offered and corresponding meeting times and locations.)

As PeopleSoft is a web application that cannot be scraped conventionally (there are no lists of URLs to scrape, for instance,) I worked with GPT-5.6 Luna to parse the XML records returned by PeopleSoft, reverse engineering a protocol to navigate the application: this way, the scraper could expand records, open links, and more. These Python scrapers collected records of course offerings and sections for Spring and Fall 2026, collecting them in JSON Files. These JSON files were parsed by a Sonnet-5.5 agent and low-cost Haiku-5.5 model to interpret text and to return them as structured outputs.

The Registrar's catalog was also scraped more conventionally, with a scraper designed by Opus-5.5. The results were fed to a Haiku 5.5 to be parsed into a structured output, creating a dataset for major / minor coursework requirements. Honors programs like Honors College, WISE Honors, University Scholars, and Honors in Computer Science are also included.

When I began this project, it wasn't immediately clear if I could collect the data needed, however, by hour 18/36 I had the data I needed.

As suggested, Compass is created with the use of Agentic AI tools in development. These include ChatGPT Web (GPT-5.6) to help build the scraper, as well as GitHub Copilot (GPT-5.6, as well) and Claude Code (Opus-5.5 and Sonnet-5.5). These agents were certainly very helpful in rapidly scaffolding a MVP! However, I found myself often guiding these agents and delegating tasks, and many times intervening to suggest implementation strategies for the audit and scheduling algorithms, intended workflow, and design considerations from a user-standpoint.

## Functionality and Implementation

The first step to using Compass is to input your previous and in-progress coursework. This can be done manually, or through a Haiku-5.5 powered PDF parser, which will automatically read a transcript and collect grades, terms, course codes, and SBCs. This is the only tool where an AI API is used at runtime.

A login / signup feature is included. Passwords are hashed with scrypt, but password resets are not implemented yet. When an account is registered, data is stored in a PostgreSQL instance hosted on Tiger Data, otherwise, it is stored locally in cookies.  

After Compass knows what academic programs (majors, minors, honors programs) a student is pursuing, and has a record of attempted coursework, the audit engine is able to analyze how far along a student is:

* each academic program is stored as a set of requirement trees, and walking those trees determines the student's progress
 	* as a result, you can see what requirements are in-progress, completed, or not yet started
* from the incomplete requirements, the "bare minimum" set of courses is found. Of course a user is welcome to take additional courses beyond the bare-minimum to graduate, however, Compass uses these courses as a baseline, and the student can see what courses are left for them to take
* the Registrar's catalog includes information on suggested coursework pacing. This information is used to schedule needed coursework over several semesters, and a student can choose their intended graduation to find a scheduling that allows them to graduate in that amount of time.
 	* so, information about "when a class is likely to run" (fall or spring sessions or both), along with suggested pacing and prerequisites are used to "rank" classes for scheduling
 	* some requirements have multiple options for satisfaction, for example a student could take a calculus course with the AMS or MAT departments! When this happens, they can choose which one they prefer

As important as staying on-track for graduation is, creating a good schedule is too. Compass has a course section search that allows you to test out different combinations of courses on a M-F calendar. Each section has information on the instructor, as well as their RateMyProfessors score.

(copy pasted from DevPost writeup)
