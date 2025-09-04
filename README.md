# Forbidden Stars Expansion Cards Webpage

This repository contains the code for a webpage dedicated to displaying the expansion cards for the Forbidden Stars game. The webpage allows users to browse through different factions and view their respective combat, orders, and events cards in an organized manner.

## Features
* Dynamic loading of faction data and card images
* Interactive tab interface to switch between factions and card categories
* Custom fonts for card text rendering
* Responsive design for optimal viewing

## Usage

* To set up the project locally it's either use xampp or different local server.
* Use this link: <a href='https://molonlabem.github.io/Forbidden_Star/page/'>Forbidden Star Page</a>

## Usage
Start your local server to serve the project files.
Open localhost in your web browser.

## Project Structure
* index.html: Main HTML file for the webpage.
* styles.css: CSS file for styling the webpage. Not much there.
* script.js: JavaScript file containing the main logic for loading and displaying the cards. It's terrbile since i'm not a front-end guy.
* fonts/: Directory containing custom font files.
* factions/: Directory containing JSON files and images for each faction.

### JSON File Structure

#### fileNames.json
This file contains an array of factions and their corresponding files. It's pre-fixed so keep that structure.
To add afaction, just add factions directory to the faction directory and add the same name to fileNames.json
ie. "factions": ["Faction1", "Faction2", "Faction3"],

#### text.json
Each faction has a text.json file containing the text data for their cards. 
Based on the empty one prepare your faction accordingly :) 


### JavaScript Overview
The main JavaScript logic is encapsulated in the script.js file, which handles the whole page.
It can easly done better but this works. 

## Contributing
Contributions are welcome! Feel free to submit a pull request or open an issue.

## License
I do not own anything realted to GamesWorkshop, i do not owne the illustrations, it's a fan passion project.
