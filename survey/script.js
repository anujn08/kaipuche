// Drafts contain data only; dynamic controls are rebuilt using the survey's handlers.
const SURVEY_DRAFT_KEY = 'charDhamSurveyDraftV1';
let draftReady = false;
let restoringDraft = false;
let draftStarted = false;
let draftSaveTimer;

function scheduleSurveyDraft() {
    if (restoringDraft) return;
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(saveSurveyDraft, 200);
}

function clearSurveyDraft() {
    clearTimeout(draftSaveTimer);
    draftStarted = false;
    try { localStorage.removeItem(SURVEY_DRAFT_KEY); } catch (error) { console.warn('Could not clear survey draft', error); }
}

function saveSurveyDraft() {
    if (!draftReady || restoringDraft || !form || !draftStarted || currentTab >= pages.length - 1) return;
    lockEnglishOptionValues(form);
    const fields = Array.from(form.querySelectorAll('input[name], select[name], textarea[name]')).map(control => ({
        name: control.name, type: control.type, value: control.value, checked: control.checked
    }));
    const restRows = Array.from(restLocationTableBody.rows).map(row => ({
        index: Number(row.querySelector('input[name^="restRoute_"]').name.slice('restRoute_'.length)),
        dham: row.id.startsWith('rest-row-extra-') ? '' : getVisitedDhams().find(dham => row.id === `rest-row-${getDhamSlug(dham)}`)
    }));
    const returnRows = Array.from(document.querySelectorAll('#returnModeTable tbody tr')).map(row =>
        Array.from(row.querySelectorAll('[name]')).map(control => control.name));
    const extraPrimaryRows = Array.from(primaryModeTableBody.querySelectorAll('[id^="primary-row-extra-"]'))
        .map(row => Number(row.id.slice('primary-row-extra-'.length)));
    const timings = { ...fatigueData, pageTimings: { ...fatigueData.pageTimings } };
    if (_pageEnterTime !== null && _pageEnterId) {
        timings.pageTimings[_pageEnterId] = (timings.pageTimings[_pageEnterId] || 0) + Math.round((Date.now() - _pageEnterTime) / 1000);
    }
    try {
        localStorage.setItem(SURVEY_DRAFT_KEY, JSON.stringify({ version: 1, pageId: pages[currentTab].id,
            fields, restRows, returnRows, extraPrimaryRows, primaryModeRowIndex, restLocationRowIndex,
            choiceBlock, taskMap: selectedChoiceTaskNumbersBySet, timings }));
    } catch (error) { console.warn('Could not save survey draft', error); }
}

function restoreSurveyDraft(draft) {
    restoringDraft = true;
    try {
        choiceBlock = draft.choiceBlock;
        selectedChoiceTaskNumbersBySet = draft.taskMap || {};
        saveChoiceTaskMap();
        // Rest row indices are part of submitted field names, so retain them exactly.
        const restoreExtraRows = () => {
            (draft.extraPrimaryRows || []).forEach(index => {
                primaryModeTableBody.insertAdjacentHTML('beforeend', createPrimaryModeRowHTML(index, '', 'manual'));
            });
            restLocationTableBody.innerHTML = (draft.restRows || []).map(row => createRestLocationRowHTML(row.index, row.dham || '')).join('');
            initializeOtherSpecifyFields(restLocationTableBody);
            const returnBody = document.querySelector('#returnModeTable tbody');
            returnBody.innerHTML = '';
            (draft.returnRows || []).forEach(names => {
                addReturnRow();
                Array.from(returnBody.lastElementChild.querySelectorAll('[name]')).forEach((control, index) => {
                    const oldName = control.name;
                    control.name = names[index];
                    returnBody.lastElementChild.querySelectorAll('[data-occupancy-for]').forEach(cell => {
                        if (cell.dataset.occupancyFor === oldName) cell.dataset.occupancyFor = control.name;
                    });
                });
            });
        };
        const applyFields = dispatch => {
            const occurrences = new Map();
            const indexControls = () => {
                const groups = new Map();
                form.querySelectorAll('input[name], select[name], textarea[name]').forEach(control => {
                    if (!groups.has(control.name)) groups.set(control.name, []);
                    groups.get(control.name).push(control);
                });
                return groups;
            };
            let groups = indexControls();
            // Iterate saved fields, looking up live controls after each rebuilding handler.
            draft.fields.forEach(field => {
                const controls = groups.get(field.name) || [];
                const isChoice = field.type === 'radio' || field.type === 'checkbox';
                const occurrence = occurrences.get(field.name) || 0;
                occurrences.set(field.name, occurrence + 1);
                const control = isChoice ? controls.find(item => item.value === field.value) : controls[occurrence];
                if (!control) return;
                const changed = isChoice ? control.checked !== field.checked : control.value !== field.value;
                if (isChoice) control.checked = field.checked;
                else control.value = field.value;
                if (dispatch && changed && (!isChoice || field.checked)) {
                    control.dispatchEvent(new Event('change', { bubbles: true }));
                    groups = indexControls();
                }
            });
        };
        // Dependencies span shrine selection, sequence, transfers, modes and other fields.
        for (let pass = 0; pass < 6; pass++) applyFields(true);
        restoreExtraRows();
        for (let pass = 0; pass < 3; pass++) applyFields(true);
        applyFields(false);
        const satSlider = document.getElementById('satisfactionSlider');
        if (satSlider && satSlider.value) updateSatisfactionSlider(satSlider);
        const waitingRange = form.querySelector('[name="lastMileApproachWaitingRange_Kedarnath"]');
        const waitingExact = form.querySelector('[name="lastMileApproachWaitingTime_Kedarnath"]');
        if (waitingRange && !waitingRange.value && waitingExact?.value !== '') waitingRange.value = 'exact';
        updateKedarnathApproachDetails();
        const hemkundWaitingRange = form.querySelector('[name="lastMileApproachWaitingRange_HemkundSahib"]');
        const hemkundWaitingExact = form.querySelector('[name="lastMileApproachWaitingTime_HemkundSahib"]');
        if (hemkundWaitingRange && !hemkundWaitingRange.value && hemkundWaitingExact?.value !== '') hemkundWaitingRange.value = 'exact';
        updateHemkundTaxiDetails();
        getLastMileRows().forEach(row => updateLastMileTimeChoice(row, true));
        getLastMileRows().forEach(row => updateLastMileCostChoice(row, true));
        document.querySelectorAll('.last-mile-return-card').forEach(card => {
            const slug = card.id.replace('last-mile-return-', '');
            updateLastMileReturnDetails(slug, true);
        });
        updateAccommodationCosts(true);
        // Drafts saved before quick ranges were introduced contain exact numbers only.
        restLocationTableBody.querySelectorAll('tr').forEach(row => {
            ['Duration', 'Cost'].forEach(kind => {
                const choice = row.querySelector(`select[name^="rest${kind}Choice_"]`);
                const exact = row.querySelector(`input[name^="rest${kind}_"]`);
                if (choice && exact && !choice.value && exact.value !== '') choice.value = 'exact';
            });
            updateStopoverChoices(row.querySelector('select[name^="restPurpose_"]'));
        });
        updateModeBlockVisibility('ropeway');
        updateModeBlockVisibility('rail');
        primaryModeRowIndex = draft.primaryModeRowIndex || 0;
        restLocationRowIndex = draft.restLocationRowIndex || 0;
        if (draft.timings) Object.assign(fatigueData, draft.timings);
        _pageEnterTime = null;
        _pageEnterId = null;
        currentTab = Math.max(0, pages.findIndex(page => page.id === draft.pageId));
        updateChoiceBlockInput();
        initializeOtherSpecifyFields();
        if (typeof updateReturnJourneyDetails === 'function') updateReturnJourneyDetails();
        renderJourneyPreviews();
        showTab(currentTab);
        draftStarted = true;
    } finally { restoringDraft = false; }
    saveSurveyDraft();
}

function initializeSurveyDraft() {
    let draft;
    try {
        draft = JSON.parse(localStorage.getItem(SURVEY_DRAFT_KEY) || 'null');
        if (draft && (draft.version !== 1 || !Array.isArray(draft.fields) || !pages.some(page => page.id === draft.pageId && page.id !== 'page-7-thankyou'))) {
            clearSurveyDraft();
            draft = null;
        }
    } catch (error) { clearSurveyDraft(); }
    draftReady = true;
    form.addEventListener('input', () => { draftStarted = true; scheduleSurveyDraft(); });
    form.addEventListener('change', () => { draftStarted = true; scheduleSurveyDraft(); });
    // Buttons also add/delete rows and set quick ratings without input events.
    form.addEventListener('click', () => {
        if (currentTab > 0 && currentTab < pages.length - 1) draftStarted = true;
        scheduleSurveyDraft();
    });
    window.addEventListener('pagehide', saveSurveyDraft);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveSurveyDraft(); });
    if (!draft) return;
    const dialog = document.getElementById('resumeDraftDialog');
    dialog.addEventListener('cancel', event => event.preventDefault());
    document.getElementById('resumeDraftBtn').onclick = () => { restoreSurveyDraft(draft); dialog.close(); };
    document.getElementById('freshDraftBtn').onclick = () => { startNewResponse(); dialog.close(); };
    dialog.showModal();
}

// --- GLOBAL DATA (No DOM dependency) ---
// Choice cards are loaded from main_haul.csv and last_mile.csv.
let mainHaulTasks = {};
let lastMileTasks = {};
let choiceDataSource = "csv";

const fallbackMainHaulCsv = `Dham,Task,Cost_A,Time_A,Comfort_A,Reliability_A,Transfers_A,Cost_B,Time_B,Comfort_B,Reliability_B,Transfers_B,Cost_C,Time_C,Comfort_C,Reliability_C,Transfers_C,Alt_A,Alt_B,Alt_C
Kedarnath,1,500,4.5,High,High,1,600,8,Medium,Medium,1,800,3.5,Luxury,Very High,0,Railway,Bus/MiniBus,Private Car
Kedarnath,2,1050,6,Medium,Medium,1,600,4.5,High,High,1,4.55,10,Low,Low,0,Bus/MiniBus,Railway,Shared Taxi
Badrinath,1,500,4.5,High,High,1,600,8,Medium,Medium,1,800,3.5,Luxury,Very High,0,Railway,Bus/MiniBus,Private Car
Badrinath,2,1050,6,Medium,Medium,1,600,4.5,High,High,1,4.55,10,Low,Low,0,Bus/MiniBus,Railway,Shared Taxi
Hemkund Sahib,1,500,4.5,High,High,1,600,8,Medium,Medium,1,800,3.5,Luxury,Very High,0,Railway,Bus/MiniBus,Private Car
Hemkund Sahib,2,1050,6,Medium,Medium,1,600,4.5,High,High,1,4.55,10,Low,Low,0,Bus/MiniBus,Railway,Shared Taxi`;

const fallbackLastMileCsv = `Dham,Task,Cost_A,Time_A,Comfort_A,Reliability_A,Transfers_A,Cost_B,Time_B,Comfort_B,Reliability_B,Transfers_B,Cost_C,Time_C,Comfort_C,Reliability_C,Transfers_C,Alt_A,Alt_B,Alt_C
Kedarnath,1,1500,1.5,Very High,High,0,800,2.5,Medium,Medium,0,0,4,Low,Low,0,Ropeway,Pony,Trek
Kedarnath,2,1000,2,High,Medium,0,2500,1,Luxury,Very High,0,0,5,Low,Low,0,Palki,Helicopter,Trek
Yamunotri,1,1500,1.5,Very High,High,0,800,2.5,Medium,Medium,0,0,4,Low,Low,0,Ropeway,Pony,Trek
Yamunotri,2,1000,2,High,Medium,0,2500,1,Luxury,Very High,0,0,5,Low,Low,0,Palki,Helicopter,Trek
Hemkund Sahib,1,1500,1.5,Very High,High,0,800,2.5,Medium,Medium,0,0,4,Low,Low,0,Ropeway,Pony,Trek
Hemkund Sahib,2,1000,2,High,Medium,0,2500,1,Luxury,Very High,0,0,5,Low,Low,0,Palki,Helicopter,Trek`;

// --- GLOBAL VARIABLES ---
// These are declared globally so all functions can access them,
// but they will be *assigned* their values once the DOM is ready.
let currentTab = 0;
let responses = [];
let primaryModeRowIndex = 0;
let lastMileRowIndex = 0; // Note: This index isn't used, rows are managed by shrine name
let restLocationRowIndex = 0;
let choiceBlock = null;
let selectedChoiceTaskNumbersBySet = {};

// Change this number when you want each respondent to see more/fewer cards per visited shrine.
// Example: 4 means each respondent sees 4 cards per visited shrine.
const CHOICE_CARDS_PER_BLOCK = 4;

// "random" gives each respondent a random combination of cards.
// "sequential" gives block 1 tasks 1-4, block 2 tasks 5-8, etc.
const CHOICE_BLOCK_MODE = "random";

// Optional exact block setup. Leave as null to auto-build blocks from the CSV task order.
// Example:
// const CUSTOM_CHOICE_BLOCK_TASKS = {
//     1: [1, 4, 7],
//     2: [2, 5, 8],
//     3: [3, 6]
// };
const CUSTOM_CHOICE_BLOCK_TASKS = null;

let form = null;
let tableBody = null;
let pages = null;
let steps = null;
let pageBackground = null;
let googleSheetTarget = null;
let primaryModeTableBody = null;
let lastMileTableBody = null;
let stayDurationTableBody = null;
let restLocationTableBody = null;
let dhamCheckboxes = null;
let choiceBlockInput = null;
let googleTranslateElement = null;
let floatingTranslateMount = null;
let consentTranslateMount = null;
let surveyStartTimestampInput = null;
let surveySubmitTimestampInput = null;
let surveyCompletionSecondsInput = null;

// Prevent a refresh from reopening the survey halfway down the document.
if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}


// --- CORE FUNCTIONS (Called from HTML or Event Listeners) ---
// These are all defined globally so your HTML `onclick="..."` attributes can find them.

/**
 * [FIX #1]
 * This function is corrected. It now hides ALL pages first,
 * then shows ONLY the one specified by 'n'. This fixes the
 * "pages showing on top of each other" bug.
 */
function showTab(n) {
    if (!pages || !steps || !pageBackground) {
        console.error("showTab called before DOM was ready.");
        return; 
    }

    // Hide ALL pages
    pages.forEach((page, index) => {
        page.style.display = "none";
    });

    // Show ONLY the current page
    pages[n].style.display = "block";

    // A newly displayed section must always begin at the top. Browsers otherwise
    // retain the scroll position from the longer section that was just hidden.
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });

    updateProgressStep(n);
    updateBackground(n);
    updateTranslatePlacement(n);
    recordPageEnter(pages[n] ? pages[n].id : null);

    // Navigation buttons logic
    const prevBtn = pages[n].querySelector('button[onclick="nextPrev(-1)"]');
    const nextBtn = pages[n].querySelector('button[onclick="nextPrev(1)"]');
    const submitBtn = pages[n].querySelector('#submitBtn');
    
    // Special case for Consent page (Page 0)
    if (n === 0) {
        if(prevBtn) prevBtn.style.display = "none";
    } else {
        if(prevBtn) prevBtn.style.display = "inline-block"; // Ensure prev button is visible on other pages
    }

    // Special case for Thank You page (Page 6)
    if (n === pages.length - 1) {
        if(nextBtn) nextBtn.style.display = "none";
        if(submitBtn) submitBtn.style.display = "none";
    }
}

function updateTranslatePlacement(pageIndex) {
    if (!googleTranslateElement || !floatingTranslateMount || !consentTranslateMount) return;

    if (pageIndex === 0) {
        if (googleTranslateElement.parentElement !== consentTranslateMount) {
            consentTranslateMount.appendChild(googleTranslateElement);
        }
    } else if (googleTranslateElement.parentElement !== floatingTranslateMount) {
        floatingTranslateMount.appendChild(googleTranslateElement);
    }
}

function nextPrev(n) {
    // A submitted response is complete; only startNewResponse may leave this page.
    if (currentTab === pages.length - 1) return false;

    // Validation: Only validate if moving forward (n=1)
    if (n > 0) {
        if (!validatePage(currentTab)) {
            // Keep the current timers running while the respondent corrects answers.
            return false;
        }

        if (currentTab === 0) {
            initializeSurveyTiming();
        }
    }

    recordPageExit(pages[currentTab].id);
    if (n < 0) fatigueData.backNavigations++;
    pages[currentTab].style.display = "none";

    // Move to next/prev tab
    currentTab = currentTab + n;

    // Check if we are at the submission step.
    if (currentTab === pages.length - 1) { // If this is the Thank You page
        // We assume validation passed on the previous page.
        handleFormSubmit();
    }
    
    // Show the new page
    showTab(currentTab);
    if (currentTab > 0 && currentTab < pages.length - 1) draftStarted = true;
    saveSurveyDraft();
}

// Returns true if the element is rendered and interactable (no hidden ancestor, not disabled).
function isEffectivelyVisible(el) {
    if (el.disabled || el.closest('[hidden]')) return false;
    // Layout handles CSS and both display:none / display: none spellings.
    return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function validatePage(n) {
    let valid = true;
    if (!pages) return false; // Safety check
    const page = pages[n];
    let firstInvalidEl = null;

    // 1. Check all 'required' inputs (text, select, etc.)
    const requiredInputs = page.querySelectorAll('input[required], select[required], textarea[required]');

    requiredInputs.forEach(el => {
        // Clear previous invalid visual cues
        el.style.border = '1px solid #ccc';

        if (el.type === 'radio' || el.type === 'checkbox') {
            // Radio/Checkbox validation is handled by group below
        } else if (!isEffectivelyVisible(el)) {
            // hidden or disabled skip, don't validate
        } else if (el.type !== 'checkbox' && el.value.trim() === '') {
            valid = false;
            el.style.border = '2px solid red';
            if (!firstInvalidEl) firstInvalidEl = el;
        } else if (el.type === 'number' && (el.value === '' || (el.min && parseFloat(el.value) < parseFloat(el.min)))) {
            valid = false;
            el.style.border = '2px solid red';
            if (!firstInvalidEl) firstInvalidEl = el;
        }
    });

    // 2. Check Radio groups explicitly
    const radioGroups = page.querySelectorAll('input[type="radio"][required]');
    const radioGroupNames = new Set(Array.from(radioGroups).map(r => r.name));

    radioGroupNames.forEach(name => {
        const firstRadio = page.querySelector(`input[name="${name}"]`);
        const groupContainer = firstRadio?.closest('table, div.dham-block, .answer-question');
        if (groupContainer) groupContainer.style.border = 'none';

        if (!isEffectivelyVisible(firstRadio)) return; // group is hidden skip

        if (!page.querySelector(`input[name="${name}"]:checked`)) {
            valid = false;
            if (groupContainer) {
                groupContainer.style.border = '2px solid red';
                if (!firstInvalidEl) firstInvalidEl = groupContainer;
            }
        }
    });

    // Optional lucky-draw contact: if filled, must be a 10-digit Indian mobile or a UPI ID.
    const upiInput = page.querySelector('#luckyDrawUpi');
    if (upiInput) {
        upiInput.style.border = '1px solid #ccc';
        const upi = upiInput.value.replace(/[\s-]+/g, '').replace(/^(\+91|91)(?=\d{10}$)/, '');
        if (upi && !/^([6-9]\d{9}|[\w.-]{2,}@[A-Za-z]{2,})$/.test(upi)) {
            upiInput.style.border = '2px solid red';
            upiInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            alert('Please enter a valid 10-digit GPay number or UPI ID, or leave the lucky-draw box empty.');
            return false;
        }
    }

    if (!valid && firstInvalidEl) {
        firstInvalidEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // 4. Check Checkbox groups for A4.2 (Last Mile Mode)
    if (page.id === 'page-2-B') {
        if (!validateGroupComposition()) {
            valid = false;
        }

        const currentVisitCheckboxes = page.querySelectorAll('.current-dham-checkbox');
        const hasCurrentVisit = Array.from(currentVisitCheckboxes).some(cb => cb.checked);
        const visitHistoryTable = currentVisitCheckboxes[0]?.closest('table');
        if (visitHistoryTable) {
            visitHistoryTable.style.border = 'none';
        }
        if (!hasCurrentVisit) {
            valid = false;
            if (visitHistoryTable) {
                visitHistoryTable.style.border = '2px solid red';
            }
        }

        const sequenceSelects = Array.from(page.querySelectorAll('select[name^="dhamSequence_"]'));
        const selectedSequence = sequenceSelects.map(select => select.value).filter(Boolean);
        const hasDuplicateSequence = selectedSequence.length !== new Set(selectedSequence).size;
        sequenceSelects.forEach(select => {
            select.style.border = '1px solid #ccc';
            if (hasDuplicateSequence && select.value) {
                select.style.border = '2px solid red';
            }
        });
        if (hasDuplicateSequence) {
            valid = false;
        }

    }

    if (!valid) {
        alert('Please fill out all required fields. Invalid fields are highlighted in red.');
    }
    
    return valid;
}

function updateProgressStep(n) {
    if (!steps) return;
    steps.forEach((step, index) => {
        if (index === n) {
            step.classList.add("active");
        } else {
            step.classList.remove("active");
        }
    });
}

function updateBackground(n) {
    if (!pageBackground) return;
    pageBackground.className = `page-background bg-${n}`;
}

// --- DCE Functions ---
function getVisitedDhams() {
    if (!dhamCheckboxes) return [];
    const visitedDhams = [];
    dhamCheckboxes.forEach(cb => {
        if (cb.checked) {
            visitedDhams.push(cb.dataset.dham);
        }
    });
    return visitedDhams;
}

function updateOngoingDhamStatus() {
    const section = document.getElementById('ongoingDhamStatusSection');
    const container = document.getElementById('ongoingDhamStatusCards');
    if (!section || !container) return;
    const isOngoing = document.querySelector('input[name="tripStatus"]:checked')?.value === 'Ongoing';
    const selectedDhams = getVisitedDhams();
    const previous = {};
    container.querySelectorAll('input[type="radio"]:checked').forEach(input => { previous[input.name] = input.value; });
    section.style.display = isOngoing && selectedDhams.length ? 'block' : 'none';
    if (!isOngoing || !selectedDhams.length) {
        container.querySelectorAll('input').forEach(input => { input.disabled = true; input.required = false; });
        return;
    }
    container.innerHTML = selectedDhams.map(dham => {
        const name = `ongoingDhamStatus_${getDhamSlug(dham)}`;
        return `<fieldset class="ongoing-dham-status-card"><legend>${escapeHTML(dham)}</legend>${getCompactChoiceButtonsHTML(name, [
            ['Completed', 'Completed'], ['Currently underway', 'Currently travelling / at the shrine'], ['Planned next', 'Planned next'], ['Planned later', 'Planned later']
        ], previous[name] || '')}</fieldset>`;
    }).join('');
}

function parseCsv(text) {
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let insideQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"' && insideQuotes && nextChar === '"') {
            currentCell += '"';
            i++;
        } else if (char === '"') {
            insideQuotes = !insideQuotes;
        } else if (char === ',' && !insideQuotes) {
            currentRow.push(currentCell);
            currentCell = '';
        } else if ((char === '\n' || char === '\r') && !insideQuotes) {
            if (char === '\r' && nextChar === '\n') i++;
            currentRow.push(currentCell);
            if (currentRow.some(cell => cell.trim() !== '')) rows.push(currentRow);
            currentRow = [];
            currentCell = '';
        } else {
            currentCell += char;
        }
    }

    currentRow.push(currentCell);
    if (currentRow.some(cell => cell.trim() !== '')) rows.push(currentRow);
    if (rows.length < 2) return [];

    const headers = rows[0].map(header => header.trim());
    return rows.slice(1).map(row => {
        const record = {};
        headers.forEach((header, index) => {
            record[header] = normalizeCsvValue(row[index] || '');
        });
        return record;
    }).filter(record => record.Dham);
}

function normalizeCsvValue(value) {
    const trimmedValue = String(value).trim();
    if (trimmedValue !== '' && !Number.isNaN(Number(trimmedValue))) {
        return Number(trimmedValue);
    }
    return trimmedValue;
}

function groupTasksByDham(rows) {
    return rows.reduce((groupedTasks, row) => {
        const dham = row.Dham;
        if (!groupedTasks[dham]) groupedTasks[dham] = [];
        groupedTasks[dham].push(row);
        return groupedTasks;
    }, {});
}

async function loadChoiceTaskCsv(fileName, fallbackCsv) {
    try {
        const response = await fetch(fileName, { cache: 'no-store' });
        if (!response.ok) throw new Error(`${fileName} returned ${response.status}`);
        const csvText = await response.text();
        return { tasks: groupTasksByDham(parseCsv(csvText)), source: fileName };
    } catch (error) {
        console.warn(`Could not load ${fileName}; using embedded fallback choice-card data.`, error);
        choiceDataSource = 'embedded fallback';
        return { tasks: groupTasksByDham(parseCsv(fallbackCsv)), source: 'embedded fallback' };
    }
}

async function loadChoiceCardData() {
    const [mainHaulResult, lastMileResult] = await Promise.all([
        loadChoiceTaskCsv('main_haul.csv', fallbackMainHaulCsv),
        loadChoiceTaskCsv('last_mile.csv', fallbackLastMileCsv)
    ]);

    mainHaulTasks = mainHaulResult.tasks;
    lastMileTasks = lastMileResult.tasks;

    if (mainHaulResult.source !== 'embedded fallback' && lastMileResult.source !== 'embedded fallback') {
        choiceDataSource = 'csv';
    }

    console.log(`Choice card data loaded from ${choiceDataSource}.`);
}

function assignChoiceBlock() {
    if (CHOICE_BLOCK_MODE === "random" && !CUSTOM_CHOICE_BLOCK_TASKS) {
        selectedChoiceTaskNumbersBySet = parseSavedChoiceTaskMap();
        choiceBlock = "random";
        updateChoiceBlockInput();
        return;
    }

    const totalBlocks = getTotalChoiceBlocks();
    const savedBlock = parseInt(sessionStorage.getItem('charDhamChoiceBlock'), 10);
    if (Number.isInteger(savedBlock) && savedBlock >= 1 && savedBlock <= totalBlocks) {
        choiceBlock = savedBlock;
    } else {
        choiceBlock = Math.floor(Math.random() * totalBlocks) + 1;
        sessionStorage.setItem('charDhamChoiceBlock', String(choiceBlock));
    }

    if (choiceBlockInput) {
        choiceBlockInput.value = String(choiceBlock);
    }
}

function getOrCreateRandomChoiceTaskNumbers(selectionKey, tasks) {
    const availableTaskNumbers = getTaskNumbersFromTasks(tasks);
    const cardsPerBlock = Math.min(
        availableTaskNumbers.length,
        Math.max(1, Number(CHOICE_CARDS_PER_BLOCK) || 1)
    );
    const savedTaskNumbers = selectedChoiceTaskNumbersBySet[selectionKey] || [];

    if (savedTaskNumbers.length === cardsPerBlock && savedTaskNumbers.every(taskNumber => availableTaskNumbers.includes(taskNumber))) {
        return savedTaskNumbers;
    }

    const randomTaskNumbers = shuffleArray(availableTaskNumbers).slice(0, cardsPerBlock).sort((a, b) => a - b);
    selectedChoiceTaskNumbersBySet[selectionKey] = randomTaskNumbers;
    saveChoiceTaskMap();
    updateChoiceBlockInput();
    sessionStorage.removeItem('charDhamChoiceBlock');
    return randomTaskNumbers;
}

function parseSavedChoiceTaskMap() {
    try {
        const savedValue = sessionStorage.getItem('charDhamChoiceTaskMap');
        const parsedValue = savedValue ? JSON.parse(savedValue) : {};
        if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return {};

        return Object.fromEntries(
            Object.entries(parsedValue).map(([selectionKey, taskNumbers]) => [
                selectionKey,
                Array.isArray(taskNumbers) ? taskNumbers.map(Number).filter(Number.isFinite) : []
            ])
        );
    } catch (error) {
        return {};
    }
}

function saveChoiceTaskMap() {
    sessionStorage.setItem('charDhamChoiceTaskMap', JSON.stringify(selectedChoiceTaskNumbersBySet));
}

function updateChoiceBlockInput() {
    if (!choiceBlockInput) return;

    if (CHOICE_BLOCK_MODE === "random" && !CUSTOM_CHOICE_BLOCK_TASKS) {
        choiceBlockInput.value = `random:${JSON.stringify(selectedChoiceTaskNumbersBySet)}`;
    } else {
        choiceBlockInput.value = String(choiceBlock);
    }
}

function shuffleArray(items) {
    const shuffledItems = [...items];
    for (let i = shuffledItems.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledItems[i], shuffledItems[j]] = [shuffledItems[j], shuffledItems[i]];
    }
    return shuffledItems;
}

function getConfiguredTaskBlocks() {
    if (CUSTOM_CHOICE_BLOCK_TASKS && typeof CUSTOM_CHOICE_BLOCK_TASKS === 'object') {
        return Object.entries(CUSTOM_CHOICE_BLOCK_TASKS)
            .map(([blockNumber, taskNumbers]) => ({
                blockNumber: Number(blockNumber),
                taskNumbers: Array.isArray(taskNumbers) ? taskNumbers.map(Number) : []
            }))
            .filter(block => Number.isInteger(block.blockNumber) && block.blockNumber > 0 && block.taskNumbers.length > 0)
            .sort((a, b) => a.blockNumber - b.blockNumber);
    }

    const allTaskNumbers = getAllChoiceTaskNumbers();
    const cardsPerBlock = Math.max(1, Number(CHOICE_CARDS_PER_BLOCK) || 1);
    const blocks = [];

    for (let i = 0; i < allTaskNumbers.length; i += cardsPerBlock) {
        blocks.push({
            blockNumber: blocks.length + 1,
            taskNumbers: allTaskNumbers.slice(i, i + cardsPerBlock)
        });
    }

    return blocks.length > 0 ? blocks : [{ blockNumber: 1, taskNumbers: [] }];
}

function getAllChoiceTaskNumbers() {
    const taskNumbers = new Set();
    [mainHaulTasks, lastMileTasks].forEach(taskGroups => {
        Object.values(taskGroups).forEach(tasks => {
            tasks.forEach(task => {
                const taskNumber = Number(task.Task);
                if (Number.isFinite(taskNumber)) taskNumbers.add(taskNumber);
            });
        });
    });

    return Array.from(taskNumbers).sort((a, b) => a - b);
}

function getTaskNumbersFromTasks(tasks) {
    return Array.from(new Set(
        tasks.map(task => Number(task.Task)).filter(Number.isFinite)
    )).sort((a, b) => a - b);
}

function getTotalChoiceBlocks() {
    return getConfiguredTaskBlocks().length || 1;
}

function getTasksForCurrentBlock(tasks, selectionKey = 'global') {
    if (!Array.isArray(tasks) || tasks.length === 0) return [];

    if (CHOICE_BLOCK_MODE === "random" && !CUSTOM_CHOICE_BLOCK_TASKS) {
        const selectedTaskNumbers = getOrCreateRandomChoiceTaskNumbers(selectionKey, tasks);
        return tasks.filter(task => selectedTaskNumbers.includes(Number(task.Task)));
    }

    const selectedBlock = getConfiguredTaskBlocks()[choiceBlock - 1] || getConfiguredTaskBlocks()[0];
    const blockTasks = tasks.filter(task => selectedBlock.taskNumbers.includes(Number(task.Task)));
    if (blockTasks.length > 0) return blockTasks;

    const fallbackIndex = (choiceBlock - 1) % tasks.length;
    return [tasks[fallbackIndex]];
}

function initializeDCE() {
    const visitedDhams = getVisitedDhams();
    const hasMainHaulChoiceTasks = visitedDhams.some(dham => Array.isArray(mainHaulTasks[dham]) && mainHaulTasks[dham].length > 0);
    const hasLastMileChoiceTasks = visitedDhams.some(dham => Array.isArray(lastMileTasks[dham]) && lastMileTasks[dham].length > 0);
    toggleChoiceArea('mainHaul', hasMainHaulChoiceTasks);
    toggleChoiceArea('lastMile', hasLastMileChoiceTasks);

    // Hemkund-only respondents get a short Hemkund brief instead of the all-shrine introduction.
    const hemkundOnly = visitedDhams.length === 1 && visitedDhams[0] === 'Hemkund Sahib';
    ['mainHaulGeneralBrief', 'lastMileGeneralContext', 'lastMileGeneralBrief'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = hemkundOnly ? 'none' : '';
    });
    ['mainHaulHemkundBrief', 'lastMileHemkundBrief'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = hemkundOnly ? '' : 'none';
    });
    const ropewayGateHelper = document.getElementById('ropewayGateHelper');
    if (ropewayGateHelper) ropewayGateHelper.textContent = hemkundOnly
        ? 'A ropeway is proposed from Govindghat to Hemkund Sahib. Would you use it to reach the shrine if it were available?'
        : 'Ropeways are proposed at Kedarnath, Hemkund Sahib, and Yamunotri under the National Ropeways Development Programme. Are you open to using one to reach the shrine if it were available?';
    // The willingness-to-pay field keeps its name; wtpRopewayShrine records which ropeway it refers to.
    const wtpQuestion = document.getElementById('wtpRopewayQuestion');
    if (wtpQuestion) wtpQuestion.textContent = hemkundOnly
        ? 'What is the maximum amount per person you would be willing to pay for the Govindghat–Hemkund Sahib ropeway (one-way)?'
        : 'What is the maximum amount per person you would be willing to pay for ropeway at Kedarnath (one-way)?';
    const wtpShrine = document.getElementById('wtpRopewayShrine');
    if (wtpShrine) wtpShrine.value = hemkundOnly ? 'Hemkund Sahib' : 'Kedarnath';

    // C1: Main-Haul Blocks
    Object.keys(mainHaulTasks).forEach(dham => {
        const dhamSlug = dham.replace(/\s/g, '');
        const dhamBlock = document.getElementById(`main-haul-${dhamSlug}-block`);
        const container = document.getElementById(`main-haul-${dhamSlug}-tasks`);
        if (dhamBlock && container) {
            if (visitedDhams.includes(dham)) {
                dhamBlock.style.display = 'block'; 
                const blockTasks = getTasksForCurrentBlock(mainHaulTasks[dham], `main_haul:${dhamSlug}`);
                container.innerHTML = blockTasks.map((task, index) => 
                    generateTaskHTML(task, task.Task || index + 1, 'main_haul')
                ).join('');
            } else {
                dhamBlock.style.display = 'none';
                container.innerHTML = ''; // Clear content
            }
        }
    });

    // C2: Last-Mile Blocks
    Object.keys(lastMileTasks).forEach(dham => {
        const dhamSlug = dham.replace(/\s/g, '');
        const dhamBlock = document.getElementById(`last-mile-${dhamSlug}-block`);
        const container = document.getElementById(`last-mile-${dhamSlug}-tasks`);
        
        if (dhamBlock && container) {
            if (visitedDhams.includes(dham)) {
                dhamBlock.style.display = 'block';
                const blockTasks = getTasksForCurrentBlock(lastMileTasks[dham], `last_mile:${dhamSlug}`);
                container.innerHTML = blockTasks.map((task, index) => 
                    generateTaskHTML(task, task.Task || index + 1, 'last_mile')
                ).join('');
            } else {
                dhamBlock.style.display = 'none';
                container.innerHTML = ''; // Clear content
            }
        }
    });
}

function toggleChoiceArea(area, shouldShow) {
    const idsByArea = {
        mainHaul: [
            'mainHaulChoiceTitle',
            'mainHaulProjectBrief',
            'mainHaulAttributeLegend',
            'mainHaulChoiceInstruction',
            'mainHaulChoiceCard'
        ],
        lastMile: [
            'lastMileChoiceTitle',
            'lastMileProjectBrief',
            'lastMileAttributeLegend',
            'lastMileChoiceInstruction',
            'lastMileChoiceCard',
            'integratedServicePreferences'
        ]
    };
    const noChoiceNoteIdByArea = {
        mainHaul: 'mainHaulNoChoiceNote',
        lastMile: 'lastMileNoChoiceNote'
    };

    (idsByArea[area] || []).forEach(id => {
        const element = document.getElementById(id);
        if (!element) return;
        element.style.display = shouldShow ? '' : 'none';
        element.querySelectorAll('input, select, textarea').forEach(control => {
            if (shouldShow) {
                if (control.dataset.wasRequired === 'true') control.required = true;
            } else {
                if (control.required) control.dataset.wasRequired = 'true';
                control.required = false;
            }
        });
    });

    const noChoiceNote = document.getElementById(noChoiceNoteIdByArea[area]);
    if (noChoiceNote) noChoiceNote.style.display = shouldShow ? 'none' : '';
}

function generateTaskHTML(task, index, segment) {
    const taskName = `${segment}_${task.Dham.replace(/\s/g, '')}_Task${index}`;
    const comfortIcon  = { Low: '◔', Medium: '◑', High: '●' };
    const comfortClass = { Low: 'dce-comfort-low', Medium: 'dce-comfort-med', High: 'dce-comfort-high' };
    const isLastMile = segment && segment.startsWith('last_mile');
    const comfortDesc = isLastMile
        ? { Low: 'Steep, exposed to weather', Medium: 'Assisted ride, some effort', High: 'Seated, sheltered cabin' }
        : { Low: 'Crowded, tiring', Medium: 'Adequate seating', High: 'Spacious, relaxed' };
    const relIcon  = { Low: '⚠', Medium: '~', High: '✓' };
    const relClass = { Low: 'dce-comfort-low', Medium: 'dce-comfort-med', High: 'dce-comfort-high' };
    const relDesc = isLastMile
        ? { Low: 'May be closed; long wait', Medium: 'Short waits at times', High: 'On schedule, little wait' }
        : { Low: 'Frequent delays or cancellations', Medium: 'Minor delays possible', High: 'On time' };

    const showTransfers = !(task['Transfers_A'] === 0 && task['Transfers_B'] === 0 && task['Transfers_C'] === 0);

    const alternatives = [
        { id: 'A', name: task.Alt_A },
        { id: 'B', name: task.Alt_B },
        { id: 'C', name: task.Alt_C },
    ];

    let cardsHTML = `<div class="dce-task">
        <div class="dce-task-header">Task ${escapeHTML(index)}: Which would you choose?</div>
        <div class="dce-cards">`;

    alternatives.forEach(alt => {
        const cost        = task[`Cost_${alt.id}`];
        const time        = task[`Time_${alt.id}`];
        const comfort     = task[`Comfort_${alt.id}`];
        const reliability = task[`Reliability_${alt.id}`];
        const transfers   = task[`Transfers_${alt.id}`];

        cardsHTML += `
        <div class="dce-card" id="card-${escapeAttribute(taskName)}-${alt.id}">
            <div class="dce-card-header">${getChoiceCardIcon(alt.name)} ${escapeHTML(alt.name)}</div>
            <div class="dce-attr"><span class="dce-label">Cost</span><span class="dce-value dce-cost">₹${escapeHTML(cost)}</span></div>
            <div class="dce-attr"><span class="dce-label">Travel Time</span><span class="dce-value">${escapeHTML(time)} hrs</span></div>
            <div class="dce-attr"><span class="dce-label">Comfort</span><span class="dce-value ${comfortClass[comfort] || ''}"><strong>${comfortIcon[comfort] || ''} ${escapeHTML(comfort)}</strong><br><small>${comfortDesc[comfort] || ''}</small></span></div>
            <div class="dce-attr"><span class="dce-label">Reliability</span><span class="dce-value ${relClass[reliability] || ''}"><strong>${relIcon[reliability] || ''} ${escapeHTML(reliability)}</strong><br><small>${relDesc[reliability] || ''}</small></span></div>
            ${showTransfers ? `<div class="dce-attr"><span class="dce-label">Vehicle Changes</span><span class="dce-value">${escapeHTML(transfers)} ${transfers == 1 ? 'change' : 'changes'}</span></div>` : ''}
            <div class="dce-select-row">
                <label class="dce-select-label">
                    <input type="radio" name="${escapeAttribute(taskName)}" value="${alt.id}: ${escapeAttribute(alt.name)}" required
                        onchange="highlightSelectedCard('${escapeAttribute(taskName)}','${alt.id}'); recordDceTaskTime(this)"/>
                    Choose this option
                </label>
            </div>
        </div>`;
    });

    cardsHTML += `</div></div>`;
    return cardsHTML;
}

// Card icon follows the mode name (railway and ropeway first, as their names also mention bus/taxi).
function getChoiceCardIcon(mode = '') {
    const value = String(mode).toLowerCase();
    if (/rail|train/.test(value)) return '🚆';
    if (/ropeway|cable|gondola/.test(value)) return '🚡';
    return getJourneyModeIcon(mode);
}

function highlightSelectedCard(taskName, selectedId) {
    ['A','B','C'].forEach(id => {
        const card = document.getElementById(`card-${taskName}-${id}`);
        if (card) card.classList.toggle('selected-card', id === selectedId);
    });
}

function escapeHTML(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
    return escapeHTML(value);
}

function getJourneyModeIcon(mode = '') {
    const value = String(mode).toLowerCase();
    if (/helicopter/.test(value)) return '🚁';
    if (/pony|mule/.test(value)) return '🐴';
    if (/palki|dandi/.test(value)) return '🪑';
    if (/pithu|kandi/.test(value)) return '🎒';
    if (/walk|trek/.test(value)) return '🚶';
    if (/bike|motorcycle|scooter|two-wheeler/.test(value)) return '🏍️';
    if (/bus|shuttle/.test(value)) return '🚌';
    if (/jeep|taxi|car|vehicle/.test(value)) return '🚙';
    return '➜';
}

function getJourneyPlaceCode(place = '') {
    const normalized = String(place).trim().toLowerCase();
    const codes = {
        'rishikesh': 'RKS', 'haridwar': 'HWR', 'sonprayag': 'SNP', 'gaurikund': 'GKD',
        'kedarnath': 'KDN', 'kedarnath temple': 'KDN', 'badrinath': 'BDN',
        'badrinath road-head': 'BDN', 'badrinath temple': 'BDN', 'gangotri': 'GNT',
        'gangotri road-head': 'GNT', 'gangotri temple': 'GNT', 'janki chatti': 'JKT',
        'janki chatti/kharsali': 'JKT', 'yamunotri': 'YMN', 'yamunotri temple': 'YMN',
        'govindghat': 'GVG', 'govindghat/gangharia': 'GVG', 'govindghat/ghangaria': 'GVG',
        'ghangaria': 'GHG', 'hemkund sahib': 'HKS', 'phata': 'PHT', 'sersi': 'SRS',
        'kharsali helipad': 'KHL', 'harsil/jhalla helipad': 'HJL',
        'kedarnath helipad': 'KDH', 'badrinath helipad': 'BDH',
        'guptkashi': 'GPK', 'devprayag': 'DVP', 'srinagar garhwal': 'SGR',
        'rudraprayag': 'RDP', 'karnaprayag': 'KNP', 'uttarkashi': 'UTK',
        'barkot': 'BKT', 'harsil': 'HSL', 'joshimath': 'JSM', 'pipalkoti': 'PPK',
        'chamoli': 'CML'
    };
    return codes[normalized] || String(place);
}

// ── Shrine route metadata for pictorial preview banners ──────────────────────
// profile: [[x%, y%], …]  where x=0 is trailhead, x=100 is shrine;
//   y=100 = baseline altitude, y=0 = highest point (shrine)
const DHAM_ROUTE_INFO = {
    'Kedarnath': {
        icon: '⛰️', color: '#4e7c5f', state: 'Uttarakhand',
        altitude: '3,583', district: 'Rudraprayag',
        trekLabel: '~16 km trek', trekRoute: 'Gaurikund → Kedarnath Temple',
        profile: [[0,100],[15,94],[100,0]]
    },
    'Badrinath': {
        icon: '🏔️', color: '#3a6694', state: 'Uttarakhand',
        altitude: '3,133', district: 'Chamoli',
        trekLabel: 'Road access', trekRoute: 'Joshimath → Badrinath Temple',
        profile: [[0,100],[50,60],[100,22]]
    },
    'Yamunotri': {
        icon: '🏞️', color: '#7a5c2e', state: 'Uttarakhand',
        altitude: '3,293', district: 'Uttarkashi',
        trekLabel: '~6 km trek', trekRoute: 'Janki Chatti → Yamunotri Temple',
        profile: [[0,100],[100,0]]
    },
    'Gangotri': {
        icon: '', color: '#4a5a7a', state: 'Uttarakhand',
        altitude: '3,100', district: 'Uttarkashi',
        trekLabel: 'Road access', trekRoute: 'Harsil → Gangotri Temple',
        profile: [[0,100],[50,55],[100,18]]
    },
    'Hemkund Sahib': {
        icon: '🔵', color: '#2e6b8a', state: 'Uttarakhand',
        altitude: '4,329', district: 'Chamoli',
        trekLabel: '~6 km trek', trekRoute: 'Ghangaria → Hemkund Sahib',
        profile: [[0,100],[10,97],[55,40],[100,0]]
    }
};

function dhamRouteBannerHTML(dham) {
    const info = DHAM_ROUTE_INFO[dham];
    if (!info) return `<div class="drb-name">${escapeHTML(dham)}</div>`;
    // build SVG elevation profile
    const pts = info.profile.map(([x, y]) => `${x},${y}`).join(' ');
    const fillPts = `0,100 ${pts} 100,100`;
    const svg = `<svg class="drb-profile" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon points="${fillPts}" fill="${info.color}" opacity="0.18"/>
        <polyline points="${pts}" fill="none" stroke="${info.color}" stroke-width="3.5" stroke-linejoin="round"/>
        <circle cx="${info.profile[info.profile.length-1][0]}" cy="${info.profile[info.profile.length-1][1]}" r="4" fill="${info.color}"/>
    </svg>`;
    return `<div class="dham-route-banner" style="--drb-clr:${info.color}">
        <span class="drb-icon">${info.icon}</span>
        <div class="drb-text">
            <strong class="drb-name">${escapeHTML(dham)}</strong>
            <span class="drb-meta">${info.district} dist. &nbsp;·&nbsp; <b>${info.altitude} m</b> AMSL</span>
            <span class="drb-route">${info.trekLabel} &nbsp;·&nbsp; ${escapeHTML(info.trekRoute)}</span>
        </div>
        ${svg}
    </div>`;
}
// ───────────────────────────────────────────────────────────────────────────

function journeyPlaceHTML(place, icon, kind = 'destination') {
    const fullName = String(place || 'Location');
    const label = `<span class="journey-node-name">${escapeHTML(fullName)}</span>`;
    const isTransfer = kind === 'transfer';
    return `<span class="journey-node${isTransfer ? ' journey-node-transfer' : ''}" title="${escapeAttribute(fullName)}${isTransfer ? ' vehicle/mode change' : ''}"><span class="journey-node-icon">${isTransfer ? '🔄' : icon}</span>${label}${isTransfer ? '<span class="journey-node-kind">Transfer</span>' : ''}</span>`;
}

function getMainJourneyStopsByDham() {
    const stops = {};
    document.querySelectorAll('#restLocationTable tbody tr').forEach(row => {
        const route = row.querySelector('input[name^="restRoute_"]')?.value || '';
        const match = route.match(/^Route to (.+)$/i);
        const locationSelect = row.querySelector('select[name^="restLocation_"]');
        const dham = match?.[1] || getOrderedDhams().find(name => {
            const routeText = route.toLowerCase();
            return routeText.includes(name.toLowerCase()) || routeText.includes(getMainHaulBaseDestination(name).toLowerCase());
        });
        if (!dham || !locationSelect?.value) return;
        let location = locationSelect.value;
        if (location === 'Other') {
            location = row.querySelector('input[name^="restLocation_"][name$="_otherSpecify"]')?.value || 'Other stop';
        }
        if (!stops[dham]) stops[dham] = [];
        if (!stops[dham].includes(location)) stops[dham].push(location);
    });
    return stops;
}

function journeyFlowHTML(legs) {
    if (!legs.length) return '';
    let html = journeyPlaceHTML(legs[0].from, '👤');
    legs.forEach((leg, index) => {
        const mode = leg.mode || 'Select mode';
        const modeIcon = getJourneyModeIcon(mode);
        const forwardIconClass = /helicopter|pony|mule|walk|trek|bike|motorcycle|scooter|two-wheeler|bus|shuttle|jeep|taxi|car|vehicle|pithu|kandi/i.test(mode)
            ? ' journey-mode-icon-forward'
            : '';
        const details = [];
        if (leg.timeLabel) details.push(escapeHTML(leg.timeLabel));
        else if (leg.time !== undefined && leg.time !== '') details.push(`${escapeHTML(leg.time)} hr`);
        if (leg.costLabel) details.push(escapeHTML(leg.costLabel));
        else if (leg.cost !== undefined && leg.cost !== '') details.push(`₹${escapeHTML(leg.cost)}`);
        if (leg.waiting !== undefined && leg.waiting !== '') details.push(`Wait ${escapeHTML(leg.waiting)} min`);
        html += `<span class="journey-connector">
            <span class="journey-segment-route" title="${escapeAttribute(`${leg.from} to ${leg.to}`)}">Leg ${index + 1}</span>
            <span class="journey-line"></span>
            <span class="journey-mode-icon${forwardIconClass}" title="${escapeAttribute(mode)}">${modeIcon}</span>
            <span class="journey-mode-label">${escapeHTML(mode)}</span>
            ${details.length ? `<span class="journey-mode-details">${details.join(' · ')}</span>` : ''}
            ${leg.stops?.length ? `<span class="journey-stop-label">⏸ ${leg.stops.map(stop => `<abbr title="${escapeAttribute(stop)}">${escapeHTML(getJourneyPlaceCode(stop))}</abbr>`).join(' · ')}</span>` : ''}
        </span>
        ${journeyPlaceHTML(leg.to, '📍', leg.toKind || 'destination')}`;
    });
    const transferLegend = legs.some(leg => leg.toKind === 'transfer')
        ? '<div class="journey-transfer-legend">🔄 Intermediate transfer/change location &nbsp; · &nbsp; 📍 Shrine base or destination</div>'
        : '';
    return `${transferLegend}<div class="journey-flow">${html}</div>`;
}

function getInterDhamPreviewLegs(from, to, pairKey) {
    const row = document.querySelector(`#interDhamTable tbody tr[data-inter-pair="${pairKey}"]`);
    if (!row) return [];
    let currentFrom = from;
    let currentModeInput = row.querySelector(`input[name="interDhamMode_${pairKey}"]:checked`);
    let currentTimeInput = row.querySelector(`input[name="interDhamTime_${pairKey}"]:checked`);
    let currentCostInput = row.querySelector(`input[name="interDhamCost_${pairKey}"]:checked`);
    const result = [];
    document.querySelectorAll(`#interDhamTable tbody tr[data-inter-transfer-pair="${pairKey}"] .inter-dham-transfer-card`).forEach(card => {
        const location = card.querySelector('input[name^="interDhamTransferLocation_"]')?.value.trim();
        if (!location) return;
        result.push({
            from: currentFrom, to: location, toKind: 'transfer', mode: currentModeInput?.value || '',
            time: currentTimeInput?.value || '', cost: currentCostInput?.value || '',
            timeLabel: currentTimeInput?.nextElementSibling?.textContent.trim() || '',
            costLabel: currentCostInput?.nextElementSibling?.textContent.trim() || ''
        });
        currentFrom = location;
        currentModeInput = card.querySelector('input[name^="interDhamTransferMode_"]:checked');
        currentTimeInput = card.querySelector('input[name^="interDhamTransferTime_"]:checked');
        currentCostInput = card.querySelector('input[name^="interDhamTransferCost_"]:checked');
    });
    const finalMode = currentModeInput?.value || '';
    const destinationDham = getVisitedDhams().find(dham => getMainHaulBaseDestination(dham) === to);
    const finalTo = finalMode === 'Helicopter' && destinationDham ? getHelicopterArrivalPoint(destinationDham) : to;
    result.push({
        from: currentFrom, to: finalTo, mode: finalMode,
        time: currentTimeInput?.value || '', cost: currentCostInput?.value || '',
        timeLabel: currentTimeInput?.nextElementSibling?.textContent.trim() || '',
        costLabel: currentCostInput?.nextElementSibling?.textContent.trim() || ''
    });
    return result;
}

function renderMainHaulJourneyPreview() {
    const preview = document.getElementById('mainHaulJourneyPreview');
    if (!preview) return;
    const startControl = document.querySelector('input[name="startPoint"]:checked');
    const orderedDhams = getOrderedDhams();
    const continuity = document.querySelector('input[name="onwardVehicleContinuity"]:checked')?.value || '';
    if (!startControl || !orderedDhams.length || !continuity) {
        preview.innerHTML = '<div class="journey-visual-title">Your onward journey</div><p class="journey-visual-empty">Select your starting point, shrine order, and vehicle choice to build the route.</p>';
        return;
    }

    const start = getSelectedStartPointLabel();
    const primaryRow = document.querySelector('#primaryModeTable tbody tr');
    const primaryModeInput = primaryRow?.querySelector('input[name^="primaryMode_"]:checked');
    const primaryTimeInput = primaryRow?.querySelector('input[name^="primaryTime_"]:checked');
    const primaryCostInput = primaryRow?.querySelector('input[name^="primaryCost_"]:checked');
    const primaryModeSuffix = primaryModeInput?.name.replace('primaryMode_', '') || '';
    const primaryMode = primaryModeInput?.value === 'Other'
        ? (document.querySelector(`input[name="primaryMode_${primaryModeSuffix}_otherSpecify"]`)?.value || 'Other')
        : (primaryModeInput?.value || '');
    const primaryTime = primaryTimeInput?.value || '';
    const primaryCost = primaryCostInput?.value || '';
    const primaryTimeLabel = primaryTimeInput?.nextElementSibling?.textContent.trim() || '';
    const primaryCostLabel = primaryCostInput?.nextElementSibling?.textContent.trim() || '';
    const helicopterDhams = getMainHaulHelicopterDhams();
    const helicopterScope = primaryRow?.querySelector('input[name^="primaryHelicopterScope_"]:checked')?.value || '';
    const isMultiDhamHelicopterPackage = ['Do Dham package', 'Complete Char Dham package', 'Other/private itinerary'].includes(helicopterScope);
    const packageDurationLabel = primaryRow?.querySelector('input[name^="primaryHelicopterPackageDuration_"]:checked')?.nextElementSibling?.textContent.trim() || '';
    const packageSummaryHTML = isMultiDhamHelicopterPackage && (primaryCostLabel || packageDurationLabel)
        ? `<div class="journey-package-summary"><strong>${escapeHTML(helicopterScope.replace(' package', ''))}</strong>${packageDurationLabel ? `<span>Duration: ${escapeHTML(packageDurationLabel)}</span>` : ''}${primaryCostLabel ? `<span>Total fare: ${escapeHTML(primaryCostLabel)} per person</span>` : ''}</div>`
        : '';
    const legs = [];
    if (continuity === 'Same vehicle throughout') {
        let from = start;
        orderedDhams.forEach((dham, index) => {
            const to = helicopterDhams.has(dham) ? getHelicopterArrivalPoint(dham) : getMainHaulBaseDestination(dham);
            let time = primaryTime;
            let cost = primaryCost;
            if (index > 0) {
                const pairKey = `${getDhamSlug(orderedDhams[index - 1])}__${getDhamSlug(dham)}`;
                time = document.querySelector(`input[name="interDhamTime_${pairKey}"]:checked`)?.value || '';
                cost = document.querySelector(`input[name="interDhamCost_${pairKey}"]:checked`)?.value || '';
            }
            legs.push({ from, to, mode: primaryMode, time, cost,
                timeLabel: index === 0 ? primaryTimeLabel : '', costLabel: index === 0 ? primaryCostLabel : '' });
            from = to;
        });
    } else {
        let from = start;
        const firstDestination = helicopterDhams.has(orderedDhams[0]) ? getHelicopterArrivalPoint(orderedDhams[0]) : getMainHaulBaseDestination(orderedDhams[0]);
        let currentMode = primaryMode;
        let currentTime = primaryTime;
        let currentCost = primaryCost;
        let currentTimeLabel = primaryTimeLabel;
        let currentCostLabel = primaryCostLabel;
        document.querySelectorAll('#mainHaulTransferDetailsTable tbody tr').forEach(row => {
            const location = row.querySelector('input[name^="mainHaulTransferLocation_"]')?.value.trim();
            const nextMode = row.querySelector('input[name^="mainHaulTransferMode_"]:checked')?.value || '';
            const nextTimeInput = row.querySelector('input[name^="mainHaulTransferTime_"]:checked');
            const nextCostInput = row.querySelector('input[name^="mainHaulTransferCost_"]:checked');
            const nextTime = nextTimeInput?.value || '';
            const nextCost = nextCostInput?.value || '';
            if (location) {
                legs.push({
                    from,
                    to: location,
                    toKind: 'transfer',
                    mode: currentMode,
                    time: currentTime,
                    cost: currentCost,
                    timeLabel: currentTimeLabel,
                    costLabel: currentCostLabel
                });
                from = location;
                currentMode = nextMode;
                currentTime = nextTime;
                currentCost = nextCost;
                currentTimeLabel = nextTimeInput?.nextElementSibling?.textContent.trim() || '';
                currentCostLabel = nextCostInput?.nextElementSibling?.textContent.trim() || '';
            }
        });
        legs.push({
            from,
            to: firstDestination,
            mode: currentMode,
            time: currentTime,
            cost: currentCost,
            timeLabel: currentTimeLabel,
            costLabel: currentCostLabel
        });

        for (let index = 0; index < orderedDhams.length - 1; index++) {
            const pairKey = `${getDhamSlug(orderedDhams[index])}__${getDhamSlug(orderedDhams[index + 1])}`;
            if (primaryMode === 'Helicopter' && helicopterDhams.has(orderedDhams[index + 1])) {
                legs.push({ from: legs[legs.length - 1]?.to || getHelicopterArrivalPoint(orderedDhams[index]), to: getHelicopterArrivalPoint(orderedDhams[index + 1]), mode: 'Helicopter' });
                continue;
            }
            const interTimeInput = document.querySelector(`input[name="interDhamTime_${pairKey}"]:checked`);
            const interCostInput = document.querySelector(`input[name="interDhamCost_${pairKey}"]:checked`);
            const interMode = document.querySelector(`input[name="interDhamMode_${pairKey}"]:checked`)?.value || '';
            const interDestination = interMode === 'Helicopter' ? getHelicopterArrivalPoint(orderedDhams[index + 1]) : getMainHaulBaseDestination(orderedDhams[index + 1]);
            legs.push(...getInterDhamPreviewLegs(getMainHaulBaseDestination(orderedDhams[index]), interDestination, pairKey));
        }
    }

    if (isMultiDhamHelicopterPackage) {
        legs.filter(leg => leg.mode === 'Helicopter').forEach(leg => {
            leg.time = '';
            leg.cost = '';
            leg.timeLabel = '';
            leg.costLabel = '';
        });
    }

    const stopsByDham = getMainJourneyStopsByDham();
    orderedDhams.forEach(dham => {
        const destination = getMainHaulBaseDestination(dham);
        const destinationLeg = [...legs].reverse().find(leg => leg.to === destination);
        if (destinationLeg && stopsByDham[dham]?.length) {
            destinationLeg.stops = stopsByDham[dham].filter(stop => stop !== destinationLeg.from && stop !== destinationLeg.to);
        }
    });

    const returnJourneyType = document.querySelector('input[name="returnJourneyType"]:checked')?.value || '';
    if (returnJourneyType === 'same') {
        const returnLeg = {
            from: legs[legs.length - 1]?.to || getMainHaulBaseDestination(orderedDhams[orderedDhams.length - 1]),
            to: start,
            mode: primaryMode,
            time: primaryTime,
            cost: primaryCost,
            timeLabel: primaryTimeLabel,
            costLabel: primaryCostLabel
        };
        if (isMultiDhamHelicopterPackage) {
            returnLeg.time = '';
            returnLeg.cost = '';
            returnLeg.timeLabel = '';
            returnLeg.costLabel = '';
        }
        preview.innerHTML = `<div class="journey-visual-title">Your onward and return journey</div>
            ${packageSummaryHTML}
            <div class="journey-flow-group"><strong>Onward</strong>${journeyFlowHTML(legs)}</div>
            <div class="journey-flow-group"><strong>Return directly to starting point</strong>${journeyFlowHTML([returnLeg])}</div>`;
        return;
    }

    if (returnJourneyType === 'different') {
        const finalDestination = legs[legs.length - 1]?.to || getMainHaulBaseDestination(orderedDhams[orderedDhams.length - 1]);
        const returnLegs = [];
        const rows = Array.from(document.querySelectorAll('#returnModeTable tbody tr')).filter(row => !row.hidden);
        const returnContinuity = document.querySelector('input[name="returnVehicleContinuity"]:checked')?.value || '';
        rows.forEach((row, index) => {
            const route = row.querySelector('input[name="returnRoute[]"]')?.value.trim() || '';
            const routePoints = route.split(/\s*(?:→|->|\bto\b)\s*/i).filter(Boolean);
            const returnTimeInput = row.querySelector('input[name^="returnTime_"]:checked');
            const returnCostInput = row.querySelector('input[name^="returnCost_"]:checked');
            returnLegs.push({
                from: routePoints[0] || (index === 0 ? finalDestination : returnLegs[index - 1].to),
                to: routePoints[1] || (index === rows.length - 1 ? start : 'Next transfer'),
                toKind: index === rows.length - 1 ? 'destination' : 'transfer',
                mode: row.querySelector('input[name^="returnMode_"]:checked')?.value || '',
                time: returnTimeInput?.value || '',
                cost: returnCostInput?.value || '',
                timeLabel: returnTimeInput?.nextElementSibling?.textContent.trim() || '',
                costLabel: returnCostInput?.nextElementSibling?.textContent.trim() || ''
            });
        });
        if (!returnLegs.length) returnLegs.push({ from: finalDestination, to: start, mode: '' });
        preview.innerHTML = `<div class="journey-visual-title">Your onward and return journey</div>
            ${packageSummaryHTML}
            <div class="journey-flow-group"><strong>Onward</strong>${journeyFlowHTML(legs)}</div>
            <div class="journey-flow-group"><strong>${returnContinuity === 'Changed vehicle or mode' ? 'Return with vehicle/mode changes' : 'Return with one vehicle/mode'}</strong>${journeyFlowHTML(returnLegs)}</div>`;
        return;
    }

    preview.innerHTML = `<div class="journey-visual-title">Your onward journey</div>${packageSummaryHTML}${journeyFlowHTML(legs)}`;
}

function renderLastMileJourneyPreview() {
    const preview = document.getElementById('lastMileJourneyPreview');
    if (!preview) return;
    const groups = [];
    getOrderedDhams().forEach(dham => {
        const slug = getDhamSlug(dham);
        const row = document.getElementById(`last-mile-row-${slug}`);
        if (!row) return;
        const legs = [];
        let isHelicopterRoute = false;
        if (dham === 'Hemkund Sahib') {
            const hemkundMode = document.querySelector('input[name="lastMileApproachMode_HemkundSahib"]:checked')?.value || '';
            if (hemkundMode) {
                legs.push({
                    from: 'Govindghat',
                    to: 'Pulna',
                    mode: hemkundMode,
                    time: (() => { const b = document.querySelector('select[name="lastMileApproachTimeBand_HemkundSahib"]')?.value || ''; return b === 'exact' ? document.querySelector('input[name="lastMileApproachTime_HemkundSahib"]')?.value || '' : ''; })(),
                    timeLabel: (() => { const b = document.querySelector('select[name="lastMileApproachTimeBand_HemkundSahib"]')?.value || ''; return b !== 'exact' ? b : ''; })(),
                    cost: hemkundMode === 'Shared Taxi / Shuttle'
                        ? (document.querySelector('input[name="lastMileApproachCost_HemkundSahib"]')?.value || '') : '',
                    waiting: hemkundMode === 'Shared Taxi / Shuttle'
                        ? (document.querySelector('select[name="lastMileApproachWaitingRange_HemkundSahib"]')?.value === 'exact'
                            ? document.querySelector('input[name="lastMileApproachWaitingTime_HemkundSahib"]')?.value || ''
                            : document.querySelector('select[name="lastMileApproachWaitingRange_HemkundSahib"]')?.value || '')
                        : ''
                });
            }
            const mountainDestination = document.querySelector('[name="lastMileApproachDestination_HemkundSahib"]:checked')?.value || 'Ghangaria';
            legs.push({
                from: 'Pulna',
                to: mountainDestination,
                mode: document.querySelector('[name="lastMileApproachMountainMode_HemkundSahib"]:checked')?.value || '',
                time: (() => { const b = document.querySelector('[name="lastMileApproachMountainTimeBand_HemkundSahib"]')?.value || ''; return b === 'exact' ? document.querySelector('[name="lastMileApproachMountainTime_HemkundSahib"]')?.value || '' : ''; })(),
                timeLabel: (() => { const b = document.querySelector('[name="lastMileApproachMountainTimeBand_HemkundSahib"]')?.value || ''; return b !== 'exact' ? b : ''; })(),
                cost: (() => { const b = document.querySelector('[name="lastMileApproachMountainCostBand_HemkundSahib"]')?.value || ''; return b === 'exact' ? document.querySelector('[name="lastMileApproachMountainCost_HemkundSahib"]')?.value || '' : ''; })(),
                costLabel: (() => { const b = document.querySelector('[name="lastMileApproachMountainCostBand_HemkundSahib"]')?.value || ''; return b !== 'exact' ? b : ''; })()
            });
        }
        if (dham === 'Kedarnath') {
            const accessType = document.querySelector('input[name="kedarnathAccessType"]:checked')?.value || '';
            if (accessType === 'Helicopter from helipad') {
                const boardingSelect = document.querySelector('select[name="kedarnathHelicopterBoardingPoint"]');
                const boardingPoint = boardingSelect?.value === 'Other'
                    ? (document.querySelector('input[name="kedarnathHelicopterBoardingPoint_otherSpecify"]')?.value || 'Other helipad')
                    : (boardingSelect?.value || 'Select helipad');
                legs.push({
                    from: boardingPoint,
                    to: 'Kedarnath Temple',
                    mode: 'Helicopter',
                    time: document.querySelector('input[name="kedarnathHelicopterTime"]')?.value || '',
                    cost: document.querySelector('input[name="kedarnathHelicopterCost"]')?.value || '',
                    waiting: document.querySelector('input[name="kedarnathHelicopterWaitingTime"]')?.value || ''
                });
                isHelicopterRoute = true;
            } else {
                legs.push({
                    from: 'Sonprayag',
                    to: 'Gaurikund',
                    mode: document.querySelector('input[name="lastMileApproachMode_Kedarnath"]:checked')?.value || '',
                    time: (() => { const b = document.querySelector('select[name="lastMileApproachTimeBand_Kedarnath"]')?.value || ''; return b === 'exact' ? document.querySelector('input[name="lastMileApproachTime_Kedarnath"]')?.value || '' : ''; })(),
                    timeLabel: (() => { const b = document.querySelector('select[name="lastMileApproachTimeBand_Kedarnath"]')?.value || ''; return b !== 'exact' ? b : ''; })(),
                    cost: document.querySelector('input[name="lastMileApproachCost_Kedarnath"]')?.value || '',
                    waiting: document.querySelector('select[name="lastMileApproachWaitingRange_Kedarnath"]')?.value === 'exact'
                        ? document.querySelector('input[name="lastMileApproachWaitingTime_Kedarnath"]')?.value || ''
                        : document.querySelector('select[name="lastMileApproachWaitingRange_Kedarnath"]')?.value || ''
                });
            }
        }
        const hemkundDirect = dham === 'Hemkund Sahib' && document.querySelector('[name="lastMileApproachDestination_HemkundSahib"]:checked')?.value === 'Hemkund Sahib';
        if (!isHelicopterRoute && !hemkundDirect) {
            const route = getLastMileRouteSegment(dham).split('→').map(value => value.trim());
            legs.push({
                from: route[0] || getMainHaulBaseDestination(dham),
                to: route[1] || `${dham} Temple`,
                mode: row.querySelector(`select[name="lastMileMode_${slug}"]`)?.value || '',
                time: row.querySelector(`select[name="lastMileTimeBand_${slug}"]`)?.value === 'exact'
                    ? row.querySelector(`input[name="lastMileTime_${slug}"]`)?.value || '' : '',
                timeLabel: row.querySelector(`select[name="lastMileTimeBand_${slug}"]`)?.value === 'exact'
                    ? '' : row.querySelector(`select[name="lastMileTimeBand_${slug}"]`)?.value || '',
                cost: row.querySelector(`select[name="lastMileCostBand_${slug}"]`)?.value === 'exact'
                    ? row.querySelector(`input[name="lastMileCost_${slug}"]`)?.value || '' : '',
                costLabel: row.querySelector(`select[name="lastMileCostBand_${slug}"]`)?.value === 'exact'
                    ? '' : row.querySelector(`select[name="lastMileCostBand_${slug}"]`)?.value || ''
            });
        }

        // "Same as onward" retraces every onward leg in reverse; "Different" uses the legs entered on the return card.
        const returnType = document.querySelector(`input[name="lastMileReturnType_${slug}"]:checked`)?.value || '';
        const returnLegs = legs.slice().reverse().map(leg => ({ ...leg, from: leg.to, to: leg.from, waiting: '' }));
        updateLastMileReturnRouteText(slug, returnLegs);
        let returnHTML = '';
        if (returnType === 'Different') {
            returnLegs.splice(0, returnLegs.length, ...getLastMileReturnLegValues(slug));
        }
        if ((returnType === 'Same as onward' || returnType === 'Different') && returnLegs.length) {
            returnHTML = `<div class="journey-direction"><b>Return</b>${journeyFlowHTML(returnLegs)}</div>`;
        }
        const directionLabels = returnHTML ? `<div class="journey-direction"><b>Onward</b>${journeyFlowHTML(legs)}</div>${returnHTML}` : journeyFlowHTML(legs);
        const ghangariaStop = dham === 'Hemkund Sahib' && !hemkundDirect
            ? document.querySelector('[name="lastMileApproachStop_HemkundSahib"]:checked')?.value || '' : '';
        const stopHTML = ghangariaStop ? `<p class="field-helper">Ghangaria: ${escapeHTML(ghangariaStop)}</p>` : '';
        groups.push(`<div class="journey-flow-group">${dhamRouteBannerHTML(dham)}${directionLabels}${stopHTML}</div>`);
    });

    preview.innerHTML = groups.length
        ? `<div class="journey-visual-title">Your shrine approach</div>${groups.join('')}`
        : '<div class="journey-visual-title">Your shrine approach</div><p class="journey-visual-empty">Select a shrine and last-mile mode to build the route.</p>';
}

function updateLastMileReturnRouteText(slug, returnLegs) {
    const routeNote = document.querySelector(`#last-mile-return-${slug} .last-mile-return-route`);
    if (!routeNote || !returnLegs.length) return;
    routeNote.textContent = `Same as onward means: ${[returnLegs[0].from, ...returnLegs.map(leg => leg.to)].join(' → ')}`;
}

function renderJourneyPreviews() {
    renderMainHaulJourneyPreview();
    renderLastMileJourneyPreview();
}

// --- Dynamic Table Functions ---
function getDhamSlug(dham) {
    return String(dham).replace(/\s/g, '');
}

function getMainHaulBaseDestination(dham) {
    const destinationsByDham = {
        Kedarnath: 'Sonprayag',
        Badrinath: 'Badrinath',
        Yamunotri: 'Janki Chatti',
        Gangotri: 'Gangotri',
        'Hemkund Sahib': 'Govindghat'
    };
    return destinationsByDham[dham] || 'Base Town';
}

function getDhamShrineDestination(dham) {
    const destinations = { Kedarnath: 'Kedarnath Temple', Badrinath: 'Badrinath Temple', Gangotri: 'Gangotri Temple', Yamunotri: 'Yamunotri Temple', 'Hemkund Sahib': 'Hemkund Sahib' };
    return destinations[dham] || dham;
}

function getHelicopterArrivalPoint(dham) {
    const arrivals = {
        Yamunotri: 'Kharsali Helipad',
        Gangotri: 'Harsil/Jhalla Helipad',
        Kedarnath: 'Kedarnath Helipad',
        Badrinath: 'Badrinath Helipad'
    };
    return arrivals[dham] || getDhamShrineDestination(dham);
}

function getReturnJourneyOrigin(dham) {
    return getMainHaulHelicopterDhams().has(dham) ? getHelicopterArrivalPoint(dham) : getMainHaulBaseDestination(dham);
}

function getOrderedDhams() {
    const selectedInOrder = Array.from(document.querySelectorAll('#dhamSequenceSelection select[name^="dhamSequence_"]'))
        .map(select => select.value)
        .filter(Boolean);
    const visitedDhams = getVisitedDhams();
    return selectedInOrder.length === visitedDhams.length ? selectedInOrder : visitedDhams;
}

function getPrimaryModeFieldSuffix(index, dham = '', rowType = 'manual', segmentNumber = 0) {
    if (!dham) return String(index);

    const dhamSlug = getDhamSlug(dham);
    if (rowType === 'segment') {
        return `${dhamSlug}_segment${segmentNumber}`;
    }
    return `${dhamSlug}_route`;
}

function getMainHaulTimeChoices(dham = '') {
    const choicesByDestination = {
        'Yamunotri': [['5', 'Less than 6 hr'], ['7', '6–8 hr'], ['9', '8–10 hr'], ['11', '10–12 hr'], ['13', 'More than 12 hr']],
        'Gangotri': [['6', 'Less than 7 hr'], ['8', '7–9 hr'], ['10', '9–11 hr'], ['12', '11–13 hr'], ['14', 'More than 13 hr']],
        'Kedarnath': [['7', 'Less than 8 hr'], ['9', '8–10 hr'], ['11', '10–12 hr'], ['13', '12–14 hr'], ['15', 'More than 14 hr']],
        'Badrinath': [['7', 'Less than 8 hr'], ['9', '8–10 hr'], ['11', '10–12 hr'], ['13', '12–14 hr'], ['15', 'More than 14 hr']],
        'Hemkund Sahib': [['7', 'Less than 8 hr'], ['9', '8–10 hr'], ['11', '10–12 hr'], ['13', '12–14 hr'], ['15', 'More than 14 hr']]
    };

    return choicesByDestination[dham] || [
        ['5', 'Less than 6 hr'], ['7.5', '6–9 hr'], ['10.5', '9–12 hr'],
        ['14', '12–16 hr'], ['18', 'More than 16 hr']
    ];
}

function getInterDhamTimeChoices() {
    return [['2', 'Less than 3 hr'], ['4.5', '3–6 hr'], ['7.5', '6–9 hr'], ['10.5', '9–12 hr'], ['14', 'More than 12 hr']];
}

function getTravelCostChoices() {
    return [['0', '₹0 / Included'], ['250', 'Below ₹500'], ['750', '₹500–₹1,000'], ['1500', '₹1,000–₹2,000'], ['3000', '₹2,000–₹4,000'], ['5000', 'Above ₹4,000']];
}

function getIntermediateTimeChoices() {
    return [['0.5', 'Less than 1 hr'], ['1.5', '1–2 hr'], ['3', '2–4 hr'], ['5', '4–6 hr'], ['7', 'More than 6 hr']];
}

function getIntermediateCostChoices() {
    return [['0', '₹0 / Included'], ['125', 'Below ₹250'], ['375', '₹250–₹500'], ['750', '₹500–₹1,000'], ['1500', '₹1,000–₹2,000'], ['2500', 'Above ₹2,000']];
}

function getHelicopterTimeChoices() {
    return [['0.5', 'Less than 1 hr'], ['1.5', '1–2 hr'], ['3', '2–4 hr'], ['5', '4–6 hr'], ['7', 'More than 6 hr']];
}

function getHelicopterFareChoices() {
    return [['3500', 'Below ₹5,000'], ['7500', '₹5,000–₹10,000'], ['17500', '₹10,000–₹25,000'], ['37500', '₹25,000–₹50,000'], ['75000', '₹50,000–₹1 lakh'], ['150000', '₹1–₹2 lakh'], ['250000', 'Above ₹2 lakh']];
}

function getHelicopterFareChoicesForScope(scope = '') {
    if (scope === 'Do Dham package') {
        return [['100000', 'Below ₹1.25 lakh'], ['140000', '₹1.25–₹1.50 lakh'], ['170000', '₹1.50–₹1.75 lakh'], ['190000', '₹1.75–₹2 lakh'], ['225000', 'Above ₹2 lakh']];
    }
    if (scope === 'Complete Char Dham package') {
        return [['175000', 'Below ₹2 lakh'], ['225000', '₹2–₹2.50 lakh'], ['275000', '₹2.50–₹3 lakh'], ['325000', '₹3–₹3.50 lakh'], ['375000', 'Above ₹3.50 lakh']];
    }
    return getHelicopterFareChoices();
}

function getHelicopterDurationChoices() {
    return [['1', 'Same day'], ['2', '2 days/1 night'], ['4', '3–4 days'], ['6', '5–6 days'], ['7', 'More than 6 days']];
}

function getHelicopterWaitingChoices() {
    return [['15', 'Under 30 min'], ['45', '30–60 min'], ['90', '1–2 hr'], ['180', '2–4 hr'], ['300', 'More than 4 hr']];
}

function getTransferLocationSuggestions(fromDham = '', toDham = '') {
    const pairSuggestions = {
        'Yamunotri__Gangotri': ['Barkot', 'Dharasu Bend', 'Uttarkashi', 'Harsil'],
        'Gangotri__Yamunotri': ['Harsil', 'Uttarkashi', 'Dharasu Bend', 'Barkot'],
        'Gangotri__Kedarnath': ['Uttarkashi', 'Chinyalisaur', 'Tehri', 'Srinagar Garhwal', 'Rudraprayag', 'Guptkashi', 'Sonprayag'],
        'Kedarnath__Gangotri': ['Sonprayag', 'Guptkashi', 'Rudraprayag', 'Srinagar Garhwal', 'Tehri', 'Uttarkashi', 'Harsil'],
        'Kedarnath__Badrinath': ['Guptkashi', 'Rudraprayag', 'Karnaprayag', 'Chamoli', 'Pipalkoti', 'Joshimath'],
        'Badrinath__Kedarnath': ['Joshimath', 'Pipalkoti', 'Chamoli', 'Karnaprayag', 'Rudraprayag', 'Guptkashi', 'Sonprayag'],
        'Badrinath__HemkundSahib': ['Joshimath', 'Govindghat'],
        'HemkundSahib__Badrinath': ['Govindghat', 'Joshimath'],
        'Yamunotri__Kedarnath': ['Barkot', 'Dharasu Bend', 'Tehri', 'Srinagar Garhwal', 'Rudraprayag', 'Guptkashi', 'Sonprayag'],
        'Yamunotri__Badrinath': ['Barkot', 'Dharasu Bend', 'Tehri', 'Srinagar Garhwal', 'Rudraprayag', 'Karnaprayag', 'Joshimath']
    };
    if (fromDham && toDham) {
        const mapped = pairSuggestions[`${getDhamSlug(fromDham)}__${getDhamSlug(toDham)}`];
        if (mapped) return mapped;
        return [...new Set([...(STOPOVER_LOCATIONS_BY_DHAM[fromDham] || []), ...(STOPOVER_LOCATIONS_BY_DHAM[toDham] || [])])]
            .filter(location => location !== 'Other' && location !== getMainHaulBaseDestination(fromDham) && location !== getMainHaulBaseDestination(toDham));
    }
    return (STOPOVER_LOCATIONS_BY_DHAM[toDham] || ALL_STOPOVER_LOCATIONS)
        .filter(location => location !== 'Other' && location !== getSelectedStartPointLabel() && location !== getMainHaulBaseDestination(toDham));
}

function getTransferLocationInputHTML(name, value, listId, suggestions) {
    const options = [...new Set(suggestions)].map(location => `<option value="${escapeAttribute(location)}"></option>`).join('');
    return `<input type="text" name="${name}" value="${escapeAttribute(value)}" list="${escapeAttribute(listId)}" placeholder="Choose a suggestion or type another place" autocomplete="off" required><datalist id="${escapeAttribute(listId)}">${options}</datalist>`;
}

function createPrimaryModeRowHTML(index, dham = '', rowType = 'manual', segmentNumber = 0, segmentTotal = 0) {
    const hasFixedDham = Boolean(dham);
    const isSummaryRow = rowType === 'dham';
    const isSegmentRow = rowType === 'segment';
    const dhamSlug = getDhamSlug(dham);
    const rowId = hasFixedDham
        ? isSegmentRow
            ? `primary-row-${dhamSlug}-segment-${segmentNumber}`
            : `primary-row-${dhamSlug}`
        : `primary-row-extra-${index}`;
    const fieldSuffix = getPrimaryModeFieldSuffix(index, dham, rowType, segmentNumber);
    const modeButtons = getCompactChoiceButtonsHTML(`primaryMode_${fieldSuffix}`, [
        ['Bus/MiniBus', 'Public Bus'], ['Tour/Group Bus', 'Tour Bus'],
        ['Shared Jeep/Shared Taxi', 'Shared Jeep/Taxi'], ['Reserved Taxi/Hired Car', 'Hired Taxi/Car'],
        ['Own Car', 'Own Car'], ['Own Two-wheeler/Bike', 'Bike/Scooter'],
        ['Helicopter', 'Helicopter'],
        ['Other', 'Other']
    ]);
    const timeButtons = getCompactChoiceButtonsHTML(`primaryTime_${fieldSuffix}`, getMainHaulTimeChoices(dham));
    const costButtons = getCompactChoiceButtonsHTML(`primaryCost_${fieldSuffix}`, [
        ['0', '₹0 / Included'], ['250', 'Below ₹500'], ['750', '₹500–₹1,000'],
        ['1500', '₹1,000–₹2,000'], ['3000', '₹2,000–₹4,000'], ['5000', 'Above ₹4,000']
    ]);
    const dhamOptions = `<option value="">--Select--</option><option>Kedarnath</option><option>Badrinath</option><option>Gangotri</option><option>Yamunotri</option><option>Hemkund Sahib</option><option>Complete Pilgrimage</option>`;
    const dhamInfo = DHAM_ROUTE_INFO[dham] || {};
    const dhamColor = dhamInfo.color || 'var(--brand)';
    const dhamIcon = dhamInfo.icon || '🗺️';
    const dhamCell = hasFixedDham
        ? `<span class="primary-dham-label"><span class="primary-dham-icon" aria-hidden="true">${dhamIcon}</span>${escapeHTML(dham)}</span><input type="hidden" name="primaryDham_${fieldSuffix}" value="${escapeAttribute(dham)}">`
        : `<select name="primaryDham_${fieldSuffix}" required>${dhamOptions}</select>`;
    const routeValue = isSummaryRow ? `${getSelectedStartPointLabel()} → ${getMainHaulBaseDestination(dham)}` : '';
    const routePlaceholder = isSegmentRow
        ? `Segment ${segmentNumber}: ${segmentNumber === 1 ? getSelectedStartPointLabel() : 'Previous point'} → ${segmentNumber === segmentTotal ? getMainHaulBaseDestination(dham) : 'Next point'}`
        : 'e.g., Haridwar → Rishikesh';
    const routeCell = isSummaryRow
        ? `<span class="primary-route-label">${escapeHTML(routeValue)}</span><input type="hidden" name="primaryRoute_${fieldSuffix}" value="${escapeAttribute(routeValue)}">`
        : `<input type="text" name="primaryRoute_${fieldSuffix}" placeholder="${escapeAttribute(routePlaceholder)}" required>`;
    const actionCell = hasFixedDham && !isSegmentRow
        ? ''
        : `<button type="button" class="delete-btn" onclick="deletePrimaryModeRow('${rowId}')">Remove</button>`;
    const transferFieldName = hasFixedDham
        ? `mainHaulTransferCount_${dhamSlug}`
        : `mainHaulTransferCount_extra_${index}`;
    const helicopterDhamButtons = ['Yamunotri', 'Gangotri', 'Kedarnath', 'Badrinath']
        .filter(name => getVisitedDhams().includes(name))
        .map(name => `<label><input type="checkbox" name="primaryHelicopterCoveredDhams_${fieldSuffix}" value="${escapeAttribute(name)}" disabled><span>${escapeHTML(name)}</span></label>`)
        .join('');

    const trAccent = hasFixedDham ? ` style="--dham-clr:${dhamColor}"` : '';
    return `
            <tr id="${rowId}" data-row-type="${rowType}" data-dham="${escapeAttribute(dham)}" data-segment-number="${escapeAttribute(segmentNumber)}"${trAccent}>
            <td class="journey-card-title" data-label="Journey">${dhamCell}</td>
            <td class="journey-card-route" data-label="Route">${routeCell}</td>
            <td class="transfer-column" data-label="Vehicle Changes Within This Leg"><select name="${transferFieldName}" id="${transferFieldName}" required>${getMainHaulTransferOptionsHTML('')}</select></td>
            <td data-label="Mode Used at Start of Leg">${modeButtons}<label class="primary-mode-other" id="primaryModeOther_${fieldSuffix}" style="display:none;">Please specify<input type="text" name="primaryMode_${fieldSuffix}_otherSpecify" disabled></label></td>
            <td class="primary-time-cell" data-field-suffix="${fieldSuffix}" data-label="One-Way Time">${timeButtons}<input type="hidden" name="primaryTimeRange_${fieldSuffix}"></td>
            <td class="primary-cost-cell" data-field-suffix="${fieldSuffix}" data-label="One-Way Fare">${costButtons}<input type="hidden" name="primaryCostRange_${fieldSuffix}"></td>
            <td data-label="Fare Entered As"><select name="primaryFareBasis_${fieldSuffix}" required>${getFareBasisOptionsHTML()}</select></td>
            <td class="occupancy-cell" data-label="Vehicle Occupancy" data-occupancy-for="primaryOccupancy_${fieldSuffix}">${getCompactChoiceButtonsHTML(`primaryOccupancy_${fieldSuffix}`, getVehicleOccupancyChoices())}</td>
            <td class="primary-helicopter-details" data-label="Helicopter Details" style="display:none;">
              <div class="helicopter-package-scope"><label>Helicopter service used${getCompactChoiceButtonsHTML(`primaryHelicopterScope_${fieldSuffix}`, [['Single Dham shuttle','Single Shrine'],['Do Dham package','Do Dham: Kedarnath + Badrinath'],['Complete Char Dham package','Complete Char Dham'],['Other/private itinerary','Other/private']])}</label></div>
              <div class="helicopter-covered-dhams" style="display:none;"><span class="helicopter-covered-title">Select the shrine covered</span><div class="compact-choice-buttons checkbox-choice-buttons">${helicopterDhamButtons}</div><small class="helicopter-covered-help">Select exactly one.</small></div>
              <label>Helicopter boarding point${getCompactChoiceButtonsHTML(`primaryHelicopterBoardingPoint_${fieldSuffix}`, [['Sahastradhara, Dehradun','Sahastradhara, Dehradun'],['Sersi','Sersi'],['Phata','Phata'],['Guptkashi','Guptkashi'],['Other','Other']])}</label>
              <label>Whole package duration${getCompactChoiceButtonsHTML(`primaryHelicopterPackageDuration_${fieldSuffix}`, getHelicopterDurationChoices())}</label>
              <label>What did the fare include?${getCompactChoiceButtonsHTML(`primaryHelicopterFareIncludes_${fieldSuffix}`, [['Flight only','Flight only'],['Flight and local transfers','Flight + local transfers'],['Full package','Stay, meals + transfers'],['Other','Other']])}</label>
              <label>Booking difficulty${getCompactChoiceButtonsHTML(`primaryHelicopterBookingDifficulty_${fieldSuffix}`, [['Very easy','Very easy'],['Easy','Easy'],['Difficult','Difficult'],['Very difficult','Very difficult'],['Agent/package','Used agent/package']])}</label>
              <label>Waiting time before departure${getCompactChoiceButtonsHTML(`primaryHelicopterWaiting_${fieldSuffix}`, getHelicopterWaitingChoices())}</label>
              <label>Flight disruption${getCompactChoiceButtonsHTML(`primaryHelicopterDisruption_${fieldSuffix}`, [['None','None'],['Delayed','Delayed'],['Rescheduled or cancelled','Rescheduled/cancelled']])}</label>
              <label>Paid an extra weight charge?${getCompactChoiceButtonsHTML(`primaryHelicopterWeightCharge_${fieldSuffix}`, [['No','No'],['Yes','Yes']])}</label>
            </td>
            <td class="journey-card-action">${actionCell}</td>
        </tr>`;
}

function getCompactChoiceButtonsHTML(name, options, selectedValue = '') {
    return `<div class="compact-choice-buttons">${options.map(([value, label], index) =>
        `<label><input type="radio" name="${escapeAttribute(name)}" value="${escapeAttribute(value)}"${index === 0 ? ' required' : ''}${String(value) === String(selectedValue) ? ' checked' : ''}><span>${escapeHTML(label)}</span></label>`
    ).join('')}</div>`;
}

function getCheckedChoiceLabel(name) {
    const input = document.querySelector(`input[name="${name}"]:checked`);
    return input?.nextElementSibling?.textContent.trim() || input?.value || '';
}

function updatePrimaryModeOther(input) {
    const suffix = input.name.replace('primaryMode_', '');
    const label = document.getElementById(`primaryModeOther_${suffix}`);
    const textInput = label?.querySelector('input');
    if (!label || !textInput) return;
    const show = input.value === 'Other' && input.checked;
    label.style.display = show ? 'block' : 'none';
    textInput.disabled = !show;
    textInput.required = show;
    if (!show) textInput.value = '';
}

function updatePrimaryModeSpecificFields(input) {
    const row = input.closest('tr');
    if (!row) return;
    const suffix = input.name.replace('primaryMode_', '');
    const isHelicopter = input.value === 'Helicopter' && input.checked;
    const timeCell = row.querySelector('.primary-time-cell');
    const costCell = row.querySelector('.primary-cost-cell');
    if (timeCell) timeCell.innerHTML = `${getCompactChoiceButtonsHTML(`primaryTime_${suffix}`, isHelicopter ? getHelicopterTimeChoices() : getMainHaulTimeChoices(row.dataset.dham))}<input type="hidden" name="primaryTimeRange_${suffix}">`;
    if (costCell) costCell.innerHTML = `${getCompactChoiceButtonsHTML(`primaryCost_${suffix}`, isHelicopter ? getHelicopterFareChoices() : getTravelCostChoices())}<input type="hidden" name="primaryCostRange_${suffix}">`;

    const transferCell = row.querySelector('.transfer-column');
    const transferSelect = transferCell?.querySelector('select');
    const sameVehicle = document.querySelector('input[name="onwardVehicleContinuity"]:checked')?.value === 'Same vehicle throughout';
    if (transferCell) transferCell.style.display = isHelicopter || sameVehicle ? 'none' : '';
    if (isHelicopter && transferSelect) transferSelect.value = '0';

    const helicopterDetails = row.querySelector('.primary-helicopter-details');
    if (helicopterDetails) {
        helicopterDetails.style.display = isHelicopter ? 'grid' : 'none';
        helicopterDetails.querySelectorAll('input').forEach(control => {
            control.disabled = !isHelicopter;
            control.required = isHelicopter && control.type === 'radio' && control.parentElement?.parentElement?.querySelector('input') === control;
            if (!isHelicopter) control.checked = false;
        });
        if (isHelicopter) updateHelicopterScopeUI(row);
    }
    updateMainHaulTransferDetails();
    updateInterDhamTable();
    updatePrimaryModeRouteCells();
}

function updateHelicopterScopeUI(scopeOrRow) {
    const row = scopeOrRow.closest?.('tr') || scopeOrRow;
    const details = row?.querySelector('.primary-helicopter-details');
    if (!details) return;
    const scope = details.querySelector('input[name^="primaryHelicopterScope_"]:checked')?.value || '';
    const isPackage = ['Do Dham package', 'Complete Char Dham package', 'Other/private itinerary'].includes(scope);
    const timeCell = row.querySelector('.primary-time-cell');
    if (timeCell) {
        timeCell.style.display = isPackage ? 'none' : '';
        timeCell.querySelectorAll('input').forEach(input => {
            input.disabled = isPackage;
            if (isPackage && input.type === 'radio') input.checked = false;
        });
    }
    const costCellForLabel = row.querySelector('.primary-cost-cell');
    if (costCellForLabel) costCellForLabel.dataset.label = isPackage ? 'Total Package Fare Per Person' : 'One-Way Fare';
    const covered = details.querySelector('.helicopter-covered-dhams');
    const showCovered = scope === 'Single Dham shuttle' || scope === 'Other/private itinerary';
    if (covered) covered.style.display = showCovered ? 'block' : 'none';
    covered?.querySelectorAll('input[type="checkbox"]').forEach(input => {
        input.disabled = !showCovered;
        if (!showCovered) input.checked = false;
    });
    const requiredCount = scope === 'Single Dham shuttle' ? 1 : 0;
    const title = covered?.querySelector('.helicopter-covered-title');
    const help = covered?.querySelector('.helicopter-covered-help');
    if (title) title.textContent = requiredCount === 1 ? 'Which shrine was covered?' : requiredCount === 2 ? 'Which two shrines were covered?' : 'Which Shrines were covered?';
    if (help) help.textContent = requiredCount ? `Select exactly ${requiredCount === 1 ? 'one' : 'two'}.` : 'Select all that apply.';
    const coveredInputs = Array.from(covered?.querySelectorAll('input[type="checkbox"]') || []);
    const selectedCount = coveredInputs.filter(input => input.checked).length;
    coveredInputs[0]?.setCustomValidity(requiredCount && selectedCount !== requiredCount ? `Please select exactly ${requiredCount} shrine${requiredCount > 1 ? 's' : ''}.` : '');
    details.querySelectorAll('input[name^="primaryHelicopterScope_"]').forEach(input => input.setCustomValidity(''));
    const scopeInput = details.querySelector('input[name^="primaryHelicopterScope_"]:checked');
    const visited = getVisitedDhams();
    const missingPackageDhams = scope === 'Do Dham package'
        ? ['Kedarnath', 'Badrinath'].filter(dham => !visited.includes(dham))
        : scope === 'Complete Char Dham package'
            ? ['Yamunotri', 'Gangotri', 'Kedarnath', 'Badrinath'].filter(dham => !visited.includes(dham))
            : [];
    scopeInput?.setCustomValidity(missingPackageDhams.length ? `Please add ${missingPackageDhams.join(', ')} to the shrine visit list for this package.` : '');
    const suffix = row.querySelector('input[name^="primaryMode_"]')?.name.replace('primaryMode_', '') || '';
    const costCell = row.querySelector('.primary-cost-cell');
    if (costCell && suffix) {
        const previousCost = costCell.querySelector(`input[name="primaryCost_${suffix}"]:checked`)?.value || '';
        costCell.innerHTML = `${getCompactChoiceButtonsHTML(`primaryCost_${suffix}`, getHelicopterFareChoicesForScope(scope), previousCost)}<input type="hidden" name="primaryCostRange_${suffix}">`;
    }
    updateLastMileTable();
    updateInterDhamTable();
    updatePrimaryModeRouteCells();
    renderJourneyPreviews();
}

function syncPrimaryRangeSelection(input) {
    if (input.name.startsWith('mainHaulTransferTime_') || input.name.startsWith('mainHaulTransferCost_')) {
        const isTransferTime = input.name.startsWith('mainHaulTransferTime_');
        const suffix = input.name.replace(isTransferTime ? 'mainHaulTransferTime_' : 'mainHaulTransferCost_', '');
        const hiddenName = `${isTransferTime ? 'mainHaulTransferTimeRange' : 'mainHaulTransferCostRange'}_${suffix}`;
        const hidden = input.closest('td')?.querySelector(`input[name="${hiddenName}"]`);
        if (hidden) hidden.value = input.nextElementSibling?.textContent.trim() || '';
        return;
    }
    const isTime = input.name.startsWith('primaryTime_');
    const suffix = input.name.replace(isTime ? 'primaryTime_' : 'primaryCost_', '');
    const hiddenName = `${isTime ? 'primaryTimeRange' : 'primaryCostRange'}_${suffix}`;
    const hidden = input.closest('td')?.querySelector(`input[name="${hiddenName}"]`);
    if (hidden) hidden.value = input.nextElementSibling?.textContent.trim() || '';
}

function getRoadTravelModeChoices() {
    return [
        ['Bus/MiniBus', 'Public Bus'],
        ['Tour/Group Bus', 'Tour Bus'],
        ['Shared Jeep/Shared Taxi', 'Shared Jeep/Taxi'],
        ['Reserved Taxi/Hired Car', 'Hired Taxi/Car'],
        ['Own Car', 'Own Car'],
        ['Own Two-wheeler/Bike', 'Bike/Scooter'],
        ['Helicopter', 'Helicopter'],
        ['Other', 'Other']
    ];
}

function getTransferModeChoices() {
    return getRoadTravelModeChoices().filter(([value]) => value !== 'Helicopter');
}

function getRoadTravelModeButtonsHTML(name, selectedValue = '') {
    return getCompactChoiceButtonsHTML(name, getRoadTravelModeChoices(), selectedValue);
}

function getTransferModeButtonsHTML(name, selectedValue = '') {
    return getCompactChoiceButtonsHTML(name, getTransferModeChoices(), selectedValue);
}

function getVehicleOccupancyChoices(mode = '') {
    if (/helicopter/i.test(mode)) return [['1', '1'], ['2', '2'], ['4', '3–4'], ['6', '5–6'], ['7', 'More than 6']];
    if (/bus/i.test(mode)) return [['16', '12–20'], ['25', '21–30'], ['35', '31–40'], ['45', 'Over 40']];
    if (/shared jeep|shared taxi/i.test(mode)) return [['5', 'Up to 6'], ['8', '7–8'], ['10', '9–10'], ['12', 'Over 10']];
    if (/car|reserved taxi|hired/i.test(mode)) return [['2', '1–2'], ['4', '3–4'], ['6', '5–6'], ['8', 'Over 6']];
    if (/bike|scooter|two-wheeler/i.test(mode)) return [['1', '1'], ['2', '2'], ['3', '3+']];
    return [['2', '1–2'], ['4', '3–4'], ['8', '5–8'], ['12', '9–12'], ['20', '13–20'], ['30', '21–30'], ['35', 'Over 30']];
}

function updateVehicleOccupancyButtons(modeInput) {
    const cell = modeInput.closest('tr')?.querySelector('[data-occupancy-for]');
    if (!cell) return;
    cell.innerHTML = getCompactChoiceButtonsHTML(cell.dataset.occupancyFor, getVehicleOccupancyChoices(modeInput.value));
}

function getRoadTravelModeOptionsHTML(selectedValue = '') {
    const options = [{ value: '', label: '--Choose the main mode--' }, ...getRoadTravelModeChoices().map(([value, label]) => ({ value, label }))];
    return options.map(option => {
        const selected = option.value === selectedValue ? ' selected' : '';
        return `<option value="${escapeAttribute(option.value)}"${selected}>${escapeHTML(option.label)}</option>`;
    }).join('');
}
function addPrimaryModeRow() {
    const newRowHTML = createPrimaryModeRowHTML(primaryModeRowIndex, '', 'manual');
    primaryModeTableBody.insertAdjacentHTML('beforeend', newRowHTML);
    lockEnglishOptionValues(primaryModeTableBody.lastElementChild);
    primaryModeRowIndex++;
}
function deletePrimaryModeRow(rowId) {
    document.getElementById(rowId).remove();
}

function getMainHaulTransferOptionsHTML(selectedValue = '') {
    const options = [
        { value: '', label: '--Select--' },
        { value: '0', label: 'No change within this leg' },
        { value: '1', label: 'Changed once' },
        { value: '2', label: 'Changed twice' },
        { value: '3', label: 'Changed 3 or more times' },
        { value: 'Not sure / cannot recall', label: 'Not sure / cannot recall' }
    ];

    return options.map(option => {
        const selected = String(selectedValue) === option.value ? ' selected' : '';
        return `<option value="${escapeAttribute(option.value)}"${selected}>${escapeHTML(option.label)}</option>`;
    }).join('');
}

function getFareBasisOptionsHTML(selectedValue = '') {
    const options = [
        { value: '', label: '--Select--' },
        { value: 'Per person', label: 'Per person' },
        { value: 'Group total', label: 'Group total (entire travel group)' },
        { value: 'Whole vehicle', label: 'Whole vehicle' },
        { value: 'Included in package', label: 'Included in tour/yatra package' },
        { value: 'Free / no fare paid', label: 'Free / no fare paid' },
        { value: 'Not sure', label: 'Not sure' }
    ];
    return options.map(option => {
        const selected = option.value === selectedValue ? ' selected' : '';
        return `<option value="${escapeAttribute(option.value)}"${selected}>${escapeHTML(option.label)}</option>`;
    }).join('');
}

function updateMainHaulTransferSelectors() {
    const container = document.getElementById('mainHaulTransferSelection');
    if (!container) return;

    const previousValues = {};
    container.querySelectorAll('select[name^="mainHaulTransferCount_"]').forEach(select => {
        previousValues[select.name] = select.value;
    });

    const visitedDhams = getVisitedDhams();
    const rowsHTML = visitedDhams.map(dham => {
        const dhamSlug = getDhamSlug(dham);
        const fieldName = `mainHaulTransferCount_${dhamSlug}`;
        const selectedValue = previousValues[fieldName] || '';

        return `
            <label>
              ${escapeHTML(dham)}:
              <span class="field-helper">How many times did you change vehicle or mode before reaching ${escapeHTML(getMainHaulBaseDestination(dham))}?</span>
              <select name="${fieldName}" id="${fieldName}" data-dham="${escapeAttribute(dham)}" required>
                ${getMainHaulTransferOptionsHTML(selectedValue)}
              </select>
            </label>`;
    }).join('');

    container.innerHTML = `
        <h4>Transfers before reaching base/shrine</h4>
        ${visitedDhams.length
            ? rowsHTML
            : '<p class="field-helper">Select Shrines in A2 to show separate transfer fields for each route.</p>'}
    `;

    lockEnglishOptionValues(container);
}

function updatePrimaryModeTable() {
    const orderedDhams = getOrderedDhams();
    const firstDham = orderedDhams[0] || '';

    primaryModeTableBody.querySelectorAll('tr[data-row-type="dham"], tr[data-row-type="segment"]').forEach(row => {
        if (row.dataset.dham !== firstDham || row.dataset.rowType !== 'dham') {
            row.remove();
        }
    });

    if (firstDham) {
        const dhamSlug = getDhamSlug(firstDham);
        if (!document.getElementById(`primary-row-${dhamSlug}`)) {
            primaryModeTableBody.insertAdjacentHTML('beforeend', createPrimaryModeRowHTML(primaryModeRowIndex, firstDham, 'dham'));
            lockEnglishOptionValues(primaryModeTableBody.lastElementChild);
            primaryModeRowIndex++;
        }
    }

    updatePrimaryModeRouteCells();
    const hint = document.getElementById('mainHaulTransferHint');
    if (hint) hint.textContent = firstDham
        ? `First journey leg: ${getSelectedStartPointLabel()} → ${getMainHaulBaseDestination(firstDham)}. Later legs appear under Inter-Shrine Travel.`
        : 'Select your shrine visit order to show the first journey leg.';
    handleOnwardVehicleContinuity();
}

function updateMainHaulTransferDetails() {
    const section = document.getElementById('mainHaulTransferDetails');
    const tbody = document.querySelector('#mainHaulTransferDetailsTable tbody');
    if (!section || !tbody) return;

    const firstDham = getOrderedDhams()[0] || '';
    const dhamSlug = getDhamSlug(firstDham);
    const countValue = document.getElementById(`mainHaulTransferCount_${dhamSlug}`)?.value || '';
    const transferCount = /^\d+$/.test(countValue) ? Number(countValue) : 0;

    const previousValues = {};
    tbody.querySelectorAll('input:not([type="radio"]), input[type="radio"]:checked, select').forEach(control => {
        previousValues[control.name] = control.value;
    });
    tbody.innerHTML = '';

    if (!firstDham || transferCount < 1) {
        section.style.display = 'none';
        return;
    }

    for (let number = 1; number <= transferCount; number++) {
        const suffix = `${dhamSlug}_${number}`;
        const locationName = `mainHaulTransferLocation_${suffix}`;
        const modeName = `mainHaulTransferMode_${suffix}`;
        const timeName = `mainHaulTransferTime_${suffix}`;
        const costName = `mainHaulTransferCost_${suffix}`;
        const fareBasisName = `mainHaulTransferFareBasis_${suffix}`;
        const occupancyName = `mainHaulTransferOccupancy_${suffix}`;
        const timeRangeName = `mainHaulTransferTimeRange_${suffix}`;
        const costRangeName = `mainHaulTransferCostRange_${suffix}`;
        const locationListId = `mainHaulTransferLocations_${suffix}`;
        const locationValue = previousValues[locationName] || '';
        const modeValue = previousValues[modeName] || '';
        const timeValue = previousValues[timeName] || '';
        const costValue = previousValues[costName] || '';
        const fareBasisValue = previousValues[fareBasisName] || '';
        const occupancyValue = previousValues[occupancyName] || '';
        tbody.insertAdjacentHTML('beforeend', `
            <tr class="main-haul-transfer-row">
              <td class="inter-dham-transfer-card" data-label="Intermediate Transfer">
                <div class="inter-dham-transfer-heading"><span>🔄 Intermediate transfer ${number}</span><small>Part of ${escapeHTML(getSelectedStartPointLabel())} → ${escapeHTML(getMainHaulBaseDestination(firstDham))}</small></div>
                <label>Intermediate transfer location${getTransferLocationInputHTML(locationName, locationValue, locationListId, getTransferLocationSuggestions('', firstDham))}</label>
                <label>Mode after transfer${getTransferModeButtonsHTML(modeName, modeValue)}</label>
                <label>Time after transfer${getCompactChoiceButtonsHTML(timeName, getIntermediateTimeChoices(), timeValue)}<input type="hidden" name="${timeRangeName}" value="${escapeAttribute(previousValues[timeRangeName] || '')}"></label>
                <label>Fare after transfer${getCompactChoiceButtonsHTML(costName, getIntermediateCostChoices(), costValue)}<input type="hidden" name="${costRangeName}" value="${escapeAttribute(previousValues[costRangeName] || '')}"></label>
                <label>Fare entered as<select name="${fareBasisName}" required>${getFareBasisOptionsHTML(fareBasisValue)}</select></label>
                <label>Vehicle occupancy<div data-occupancy-for="${occupancyName}">${getCompactChoiceButtonsHTML(occupancyName, getVehicleOccupancyChoices(modeValue), occupancyValue)}</div></label>
              </td>
            </tr>`);
    }

    section.style.display = 'block';
    lockEnglishOptionValues(tbody);
}

function updatePrimaryModeRouteCells() {
    if (!primaryModeTableBody) return;

    primaryModeTableBody.querySelectorAll('tr[data-row-type="dham"]').forEach(row => {
        const dham = row.dataset.dham;
        const sameVehicle = document.querySelector('input[name="onwardVehicleContinuity"]:checked')?.value === 'Same vehicle throughout';
        const transferLocations = Array.from(document.querySelectorAll('#mainHaulTransferDetailsTable input[name^="mainHaulTransferLocation_"]'))
            .map(input => input.value.trim())
            .filter(Boolean);
        const selectedMode = row.querySelector('input[name^="primaryMode_"]:checked')?.value || '';
        const helicopterDhams = getMainHaulHelicopterDhams();
        const finalDestination = helicopterDhams.has(dham) ? getHelicopterArrivalPoint(dham) : getMainHaulBaseDestination(dham);
        const destinations = sameVehicle
            ? getOrderedDhams().map(name => helicopterDhams.has(name) ? getHelicopterArrivalPoint(name) : getMainHaulBaseDestination(name))
            : [...transferLocations, finalDestination];
        const routeValue = [getSelectedStartPointLabel(), ...destinations].join(' → ');
        const routeLabel = row.querySelector('.primary-route-label');
        const routeInput = row.querySelector('input[name^="primaryRoute_"]');

        if (routeLabel) routeLabel.textContent = routeValue;
        if (routeInput) routeInput.value = routeValue;
    });
}

function handleOnwardVehicleContinuity() {
    const choice = document.querySelector('input[name="onwardVehicleContinuity"]:checked')?.value || '';
    const details = document.getElementById('mainHaulJourneyDetails');
    const sameVehicle = choice === 'Same vehicle throughout';
    if (details) details.style.display = choice ? 'block' : 'none';

    document.querySelectorAll('#primaryModeTable .transfer-column').forEach(cell => {
        const row = cell.closest('tr');
        const helicopter = Boolean(row?.querySelector('input[name^="primaryMode_"][value="Helicopter"]:checked'));
        cell.style.display = sameVehicle || helicopter ? 'none' : '';
    });
    document.querySelectorAll('#primaryModeTable .primary-dham-label').forEach(label => {
        label.textContent = sameVehicle ? 'Complete onward journey' : (getOrderedDhams()[0] || 'First Shrine');
    });

    if (sameVehicle) {
        const firstDham = getOrderedDhams()[0] || '';
        const transferSelect = document.getElementById(`mainHaulTransferCount_${getDhamSlug(firstDham)}`);
        if (transferSelect) transferSelect.value = '0';
    }

    const hint = document.getElementById('mainHaulTransferHint');
    if (hint && sameVehicle) {
        const fullRoute = [getSelectedStartPointLabel(), ...getOrderedDhams().map(getMainHaulBaseDestination)].join(' → ');
        hint.textContent = `One vehicle throughout: ${fullRoute}`;
    } else if (hint && choice === 'Changed vehicle or mode') {
        const firstDham = getOrderedDhams()[0] || '';
        hint.textContent = firstDham
            ? `First journey leg: ${getSelectedStartPointLabel()} → ${getMainHaulBaseDestination(firstDham)}. Later legs appear under Inter-Shrine Travel.`
            : 'Select your shrine visit order to show the first journey leg.';
    }

    updatePrimaryModeRouteCells();
    updateMainHaulTransferDetails();
    updateInterDhamTable();
}

function getMainHaulSegmentRowCount(dham = '') {
    const dhamSlug = getDhamSlug(dham);
    const value = document.getElementById(`mainHaulTransferCount_${dhamSlug}`)?.value || '';
    const transferCount = Number(value);
    if (Number.isFinite(transferCount) && transferCount > 0) {
        return transferCount + 1;
    }
    return 1;
}

function updateMainHaulTransferHint() {
    const hint = document.getElementById('mainHaulTransferHint');
    if (!hint) return;

    const visitedDhams = getVisitedDhams();
    const segmentedDhams = visitedDhams
        .map(dham => ({ dham, segmentCount: getMainHaulSegmentRowCount(dham) }))
        .filter(item => item.segmentCount > 1);

    if (segmentedDhams.length > 0) {
        hint.textContent = segmentedDhams
            .map(item => `${item.dham}: ${item.segmentCount} route rows`)
            .join('; ') + '. Enter each segment and mode.';
    } else if (visitedDhams.some(dham => document.getElementById(`mainHaulTransferCount_${getDhamSlug(dham)}`)?.value === 'Not sure / cannot recall')) {
        hint.textContent = 'One broad route row will show for routes marked not sure.';
    } else {
        hint.textContent = '';
    }
}

const ALL_STOPOVER_LOCATIONS = [
    'Haridwar',
    'Rishikesh',
    'Devprayag',
    'Srinagar Garhwal',
    'Rudraprayag',
    'Guptkashi',
    'Phata',
    'Sonprayag',
    'Gaurikund',
    'Karnaprayag',
    'Joshimath',
    'Pipalkoti',
    'Chamoli',
    'Badrinath',
    'Govindghat',
    'Ghangaria',
    'Uttarkashi',
    'Harsil',
    'Gangotri',
    'Barkot',
    'Janki Chatti',
    'Yamunotri',
    'Other'
];

const STOPOVER_LOCATIONS_BY_DHAM = {
    Kedarnath: ['Haridwar', 'Rishikesh', 'Devprayag', 'Srinagar Garhwal', 'Rudraprayag', 'Guptkashi', 'Phata', 'Sonprayag', 'Gaurikund', 'Other'],
    Badrinath: ['Haridwar', 'Rishikesh', 'Devprayag', 'Srinagar Garhwal', 'Rudraprayag', 'Karnaprayag', 'Chamoli', 'Pipalkoti', 'Joshimath', 'Badrinath', 'Other'],
    Gangotri: ['Haridwar', 'Rishikesh', 'Uttarkashi', 'Harsil', 'Gangotri', 'Other'],
    Yamunotri: ['Haridwar', 'Rishikesh', 'Barkot', 'Janki Chatti', 'Yamunotri', 'Other'],
    'Hemkund Sahib': ['Haridwar', 'Rishikesh', 'Devprayag', 'Srinagar Garhwal', 'Rudraprayag', 'Karnaprayag', 'Chamoli', 'Pipalkoti', 'Joshimath', 'Govindghat', 'Ghangaria', 'Other']
};

function buildStopoverLocationOptions(dham = '') {
    const startPoint = getSelectedStartPointLabel().trim().toLowerCase();
    const locations = (STOPOVER_LOCATIONS_BY_DHAM[dham] || ALL_STOPOVER_LOCATIONS)
        .filter(location => location === 'Other' || location.trim().toLowerCase() !== startPoint);
    const locationOptions = locations
        .map(location => `<option>${escapeHTML(location)}</option>`)
        .join('');
    return `<option value="">--Select location--</option>${locationOptions}`;
}

function getStopoverRanges(purpose, kind) {
    const durations = {
        'Food/Refreshment': ['Up to 15 min', '15–30 min', '30–60 min', '1–2 hr', 'Over 2 hr'],
        'Rest/Toilet Break': ['Up to 15 min', '15–20 min', '20–30 min', '30–60 min', 'Over 1 hr'],
        'Night Halt/Accommodation': ['Under 6 hr', '6–10 hr', '10–12 hr', '12–24 hr', 'Over 24 hr'],
        'Sightseeing': ['Up to 30 min', '30–60 min', '1–2 hr', '2–4 hr', 'Over 4 hr'],
        'Medical/First Aid': ['Up to 15 min', '15–30 min', '30–60 min', '1–2 hr', 'Over 2 hr'],
        'Parking/Vehicle Change': ['Up to 15 min', '15–30 min', '30–60 min', '1–2 hr', 'Over 2 hr']
    };
    if (kind === 'Duration') return durations[purpose] || ['Up to 30 min', '30–60 min', '1–2 hr', '2–6 hr', '6–10 hr', '10–24 hr', 'Over 24 hr'];
    if (purpose === 'Night Halt/Accommodation') return ['No cost (₹0)', 'Up to ₹500', '₹501–₹1,000', '₹1,001–₹2,000', '₹2,001–₹3,000', 'Over ₹3,000'];
    if (purpose === 'Rest/Toilet Break') return ['No cost (₹0)', '₹1–₹20', '₹21–₹50', '₹51–₹100', 'Over ₹100'];
    return ['No cost (₹0)', 'Up to ₹100', '₹101–₹300', '₹301–₹500', '₹501–₹1,000', 'Over ₹1,000'];
}

function getStopoverChoiceOptions(purpose, kind) {
    return '<option value="">--Choose a range--</option>' + getStopoverRanges(purpose, kind)
        .map(range => `<option value="${escapeAttribute(range)}">${escapeHTML(range)}</option>`).join('')
        + '<option value="exact">Other / exact value</option>';
}

function updateStopoverChoices(control) {
    const row = control.closest('tr');
    if (!row) return;
    const purpose = row.querySelector('select[name^="restPurpose_"]')?.value || '';
    ['Duration', 'Cost'].forEach(kind => {
        const choice = row.querySelector(`select[name^="rest${kind}Choice_"]`);
        const exact = row.querySelector(`input[name^="rest${kind}_"]`);
        if (!choice || !exact) return;
        if (control.name.startsWith('restPurpose_')) {
            const previous = choice.value;
            choice.innerHTML = getStopoverChoiceOptions(purpose, kind);
            // Keep a previously chosen range even if the new purpose suggests different ranges.
            if (previous && !Array.from(choice.options).some(option => option.value === previous)) {
                choice.add(new Option(previous, previous), choice.options.length - 1);
            }
            choice.value = previous;
            lockEnglishOptionValues(choice);
        }
        const showExact = choice.value === 'exact';
        exact.closest('label').hidden = !showExact;
        exact.disabled = !showExact;
        exact.required = showExact;
    });
}

function createRestLocationRowHTML(index, dham = '') {
    const isAutoDhamRow = Boolean(dham);
    const dhamSlug = getDhamSlug(dham);
    const rowId = isAutoDhamRow ? `rest-row-${dhamSlug}` : `rest-row-extra-${index}`;
    const purposeOptions = `<option value="">--Select--</option><option>Food/Refreshment</option><option>Rest/Toilet Break</option><option>Night Halt/Accommodation</option><option>Sightseeing</option><option>Medical/First Aid</option><option>Parking/Vehicle Change</option><option>Other</option>`;
    const locationOptions = buildStopoverLocationOptions(dham);
    const accomOptions = `<option value="N/A">N/A (Short Stop)</option><option>Roadside Food/Tea Stall</option><option>Restaurant/Dhaba</option><option>Public Rest/Toilet Facility</option><option>Hotel</option><option>Dharamsala/Gurudwara</option><option>Guest House</option><option>Ashram</option><option>Parking/Transport Hub</option><option>Other</option>`;
    const requiredAttr = isAutoDhamRow ? '' : ' required';
    const routeCell = isAutoDhamRow
        ? `Route to ${escapeHTML(dham)}<input type="hidden" name="restRoute_${index}" value="Route to ${escapeAttribute(dham)}">`
        : `<input type="text" name="restRoute_${index}" placeholder="e.g., Haridwar-Kedarnath" required>`;
    const actionCell = isAutoDhamRow
        ? ''
        : `<button type="button" class="delete-btn" onclick="deleteRestLocationRow('${rowId}')">Delete</button>`;
    return `
        <tr id="${rowId}">
            <td>${routeCell}</td>
            <td><select name="restLocation_${index}"${requiredAttr}>${locationOptions}</select></td>
            <td><select name="restPurpose_${index}"${requiredAttr}>${purposeOptions}</select></td>
            <td><select name="restDurationChoice_${index}"${requiredAttr}>${getStopoverChoiceOptions('', 'Duration')}</select><label hidden>Exact duration (hours)<input type="number" name="restDuration_${index}" min="0" step="any" placeholder="e.g., 0.25 for 15 min" disabled></label></td>
            <td><select name="restAccom_${index}"${requiredAttr}>${accomOptions}</select></td>
            <td><select name="restCostChoice_${index}"${requiredAttr}>${getStopoverChoiceOptions('', 'Cost')}</select><label hidden>Exact cost (₹)<input type="number" name="restCost_${index}" min="0" step="any" placeholder="e.g., 300" disabled></label></td>
            <td>${actionCell}</td>
        </tr>`;
}
function addRestLocationRow() {
    const newRowHTML = createRestLocationRowHTML(restLocationRowIndex);
    restLocationTableBody.insertAdjacentHTML('beforeend', newRowHTML);
    lockEnglishOptionValues(restLocationTableBody.lastElementChild);
    initializeOtherSpecifyFields(restLocationTableBody.lastElementChild);
    restLocationRowIndex++;
}
function deleteRestLocationRow(rowId) {
    document.getElementById(rowId).remove();
}

function updateRestLocationTable() {
    const visitedDhams = getVisitedDhams();
    const existingAutoRows = new Set(
        Array.from(restLocationTableBody.querySelectorAll('tr[id^="rest-row-"]:not([id^="rest-row-extra-"])'))
            .map(row => row.id.replace('rest-row-', ''))
    );

    visitedDhams.forEach(dham => {
        const dhamSlug = getDhamSlug(dham);
        if (!existingAutoRows.has(dhamSlug)) {
            restLocationTableBody.insertAdjacentHTML('beforeend', createRestLocationRowHTML(restLocationRowIndex, dham));
            lockEnglishOptionValues(restLocationTableBody.lastElementChild);
            initializeOtherSpecifyFields(restLocationTableBody.lastElementChild);
            restLocationRowIndex++;
        }
    });

    existingAutoRows.forEach(dhamSlug => {
        const dhamName = Array.from(dhamCheckboxes).find(cb => getDhamSlug(cb.dataset.dham) === dhamSlug)?.dataset.dham;
        if (dhamName && !visitedDhams.includes(dhamName)) {
            document.getElementById(`rest-row-${dhamSlug}`)?.remove();
        }
    });

    restLocationTableBody.querySelectorAll('tr').forEach(row => {
        const routeValue = row.querySelector('input[name^="restRoute_"]')?.value || '';
        const dham = routeValue.match(/^Route to (.+)$/i)?.[1] || '';
        const select = row.querySelector('select[name^="restLocation_"]');
        if (!select) return;
        const previous = select.value;
        select.innerHTML = buildStopoverLocationOptions(dham);
        if (Array.from(select.options).some(option => option.value === previous)) select.value = previous;
    });
}

function getLastMileModeOptionsHTML(dham) {
    const roadHeadOnly = dham === 'Gangotri' || dham === 'Badrinath';
    if (roadHeadOnly) {
        return `<option value="">--Select--</option><option>Trek/Walk</option><option>Other</option>`;
    }
    if (dham === 'Kedarnath') {
        return `<option value="">--Select--</option><option>Trek/Walk</option><option>Pony/Mule</option><option>Palki/Dandi</option><option>Pithu / Kandi</option><option>Other</option>`;
    }
    return `<option value="">--Select--</option><option>Trek/Walk</option><option>Pony/Mule</option><option>Palki/Dandi</option><option>Pithu / Kandi</option><option>Other</option>`;
}

function getHelipadLastMileModeOptionsHTML(dham) {
    if (dham === 'Yamunotri' || dham === 'Hemkund Sahib') return getLastMileModeOptionsHTML(dham);
    if (dham === 'Kedarnath') return '<option value="">--Select--</option><option>Trek/Walk</option><option>Pithu / Kandi</option><option>Other</option>';
    return '<option value="">--Select--</option><option>Package local transfer</option><option>Trek/Walk</option><option>Local Vehicle/Taxi</option><option>Palki/Dandi</option><option>Other</option>';
}

function getLastMileTimeBands(dham) {
    const bands = {
        Yamunotri: ['Under 1 hr', '1–3 hr', '3–6 hr', '6–9 hr', 'Over 9 hr'],
        Kedarnath: ['Under 1 hr', '1–3 hr', '3–6 hr', '6–9 hr', '9–12 hr', 'Over 12 hr'],
        'Hemkund Sahib': ['Under 1 hr', '1–3 hr', '3–6 hr', '6–9 hr', '9–12 hr', 'Over 12 hr'],
        Gangotri: ['Under 15 min', '15–30 min', '31–60 min', '1–2 hr', 'Over 2 hr'],
        Badrinath: ['Under 15 min', '15–30 min', '31–60 min', '1–2 hr', 'Over 2 hr']
    };
    return bands[dham] || ['Under 1 hr', '1–3 hr', '3–6 hr', '6–9 hr', 'Over 9 hr'];
}

function updateLastMileTimeChoice(row, migrateExact = false) {
    const choice = row?.querySelector('select[name^="lastMileTimeBand_"]');
    const exact = row?.querySelector('input[name^="lastMileTime_"]');
    if (!choice || !exact) return;
    if (migrateExact && !choice.value && exact.value !== '') choice.value = 'exact';
    const active = row.style.display !== 'none';
    choice.disabled = !active;
    choice.required = active;
    const showExact = active && choice.value === 'exact';
    exact.closest('label').hidden = !showExact;
    exact.disabled = !showExact;
    exact.required = showExact;
}

// Research anchors and route/round-trip distinctions: LAST_MILE_FARE_SOURCES.md.
function getLastMileCostBands(dham, mode) {
    if (mode === 'Trek/Walk') return ['No cost (₹0)'];
    let cuts;
    if (/Pony|Mule/.test(mode)) cuts = dham === 'Kedarnath' ? [2000,3000,4000,5000] : [1000,1500,2000,2500,3500];
    else if (/Palki|Dandi/.test(mode)) cuts = dham === 'Kedarnath' ? [6000,9000,12000,16000,20000] : [2000,3000,4500,6000,9000,12000];
    else if (/Pithu|Shoulder/.test(mode)) cuts = dham === 'Kedarnath' ? [3000,5000,7000,9000] : [500,1000,1500,2500,4000];
    else if (/Helicopter/.test(mode)) cuts = [3000,5000,7000,10000,15000];
    else cuts = [500,1000,2000,4000,6000,10000];
    const format = value => value.toLocaleString('en-IN');
    return ['No cost (₹0)', ...cuts.map((cut,index) => `₹${format(index ? cuts[index-1]+1 : 1)}–₹${format(cut)}`), `Over ₹${format(cuts[cuts.length-1])}`];
}

function updateLastMileCostChoice(row, migrateExact = false) {
    const mode = row?.querySelector('select[name^="lastMileMode_"]')?.value || '';
    const choice = row?.querySelector('select[name^="lastMileCostBand_"]');
    const exact = row?.querySelector('input[name^="lastMileCost_"]');
    if (!choice || !exact) return;
    const dham = row.dataset.dham || row.cells?.[0]?.textContent.trim() || '';
    if (choice.dataset.mode !== mode) {
        const previous = choice.value;
        const firstBuild = choice.dataset.mode === undefined;
        choice.innerHTML = '<option value="">--Choose a cost range--</option>' + getLastMileCostBands(dham, mode)
            .map(band => `<option value="${escapeAttribute(band)}">${escapeHTML(band)}</option>`).join('') + '<option value="exact">Other / exact amount</option>';
        if ((restoringDraft || firstBuild) && previous) {
            if (!Array.from(choice.options).some(option => option.value === previous)) choice.add(new Option(previous,previous));
            choice.value = previous;
        } else if (!firstBuild) exact.value = '';
        choice.dataset.mode = mode;
        lockEnglishOptionValues(choice);
    }
    if (mode === 'Trek/Walk') { choice.value = 'No cost (₹0)'; exact.value = '0'; }
    else if (migrateExact && !choice.value && exact.value !== '') choice.value = 'exact';
    const active = row.style.display !== 'none';
    choice.disabled = !active;
    choice.required = active;
    const showExact = active && choice.value === 'exact';
    exact.closest('label').hidden = !showExact;
    exact.disabled = !active || (!showExact && mode !== 'Trek/Walk');
    exact.required = showExact;
    exact.readOnly = mode === 'Trek/Walk';
}

function createLastMileRowHTML(dham) {
    const dhamSlug = dham.replace(/\s/g, '');
    const modeOptions = getLastMileModeOptionsHTML(dham);
    const routeValue = getLastMileRouteSegment(dham);
    if (dham === 'Hemkund Sahib') return createHemkundLeg3HTML(dham, dhamSlug, modeOptions, routeValue);

    return `
        <tr id="last-mile-row-${dhamSlug}" data-dham="${escapeAttribute(dham)}">
            <td>${dham}</td>
            <td><span class="last-mile-route-label">${escapeHTML(routeValue)}</span><input type="hidden" name="lastMileRoute_${dhamSlug}" value="${escapeAttribute(routeValue)}"></td>
            <td><select name="lastMileMode_${dhamSlug}" required>${modeOptions}</select></td>
            <td><label><select name="lastMileTimeBand_${dhamSlug}" required><option value="">--Choose a time band--</option>${getLastMileTimeBands(dham).map(band => `<option value="${escapeAttribute(band)}">${escapeHTML(band)}</option>`).join('')}<option value="exact">Other / exact hours</option></select></label><label hidden>Exact one-way time (hours)<input type="number" name="lastMileTime_${dhamSlug}" min="0" step="any" placeholder="e.g., 4.5" disabled></label></td>
            <td><label><select name="lastMileCostBand_${dhamSlug}" required><option value="">--Choose a cost range--</option>${getLastMileCostBands(dham, '').map(band => `<option value="${escapeAttribute(band)}">${escapeHTML(band)}</option>`).join('')}<option value="exact">Other / exact amount</option></select></label><label hidden>Exact cost per person (₹)<input type="number" name="lastMileCost_${dhamSlug}" min="0" step="any" placeholder="e.g., 2500" disabled></label></td>
            <td><button type="button" class="delete-btn" onclick="deleteLastMileRow('${dhamSlug}')">Remove</button></td>
        </tr>`;
}

// Hemkund's final leg sits inside the Hemkund onward card instead of the last-mile table.
function createHemkundLeg3HTML(dham, dhamSlug, modeOptions, routeValue) {
    return `
        <div class="return-leg" id="last-mile-row-${dhamSlug}" data-dham="${escapeAttribute(dham)}">
            <div class="return-leg-title">Leg 3: <span class="last-mile-route-label">${escapeHTML(routeValue)}</span></div>
            <input type="hidden" name="lastMileRoute_${dhamSlug}" value="${escapeAttribute(routeValue)}">
            <div class="return-leg-fields">
                <label>Mode<select name="lastMileMode_${dhamSlug}" required>${modeOptions}</select></label>
                <div class="return-field-group"><label>Time<select name="lastMileTimeBand_${dhamSlug}" required><option value="">--Choose a time band--</option>${getLastMileTimeBands(dham).map(band => `<option value="${escapeAttribute(band)}">${escapeHTML(band)}</option>`).join('')}<option value="exact">Other / exact hours</option></select></label><label hidden>Exact one-way time (hours)<input type="number" name="lastMileTime_${dhamSlug}" min="0" step="any" placeholder="e.g., 4.5" disabled></label></div>
                <div class="return-field-group"><label>Cost per person<select name="lastMileCostBand_${dhamSlug}" required><option value="">--Choose a cost range--</option>${getLastMileCostBands(dham, '').map(band => `<option value="${escapeAttribute(band)}">${escapeHTML(band)}</option>`).join('')}<option value="exact">Other / exact amount</option></select></label><label hidden>Exact cost per person (₹)<input type="number" name="lastMileCost_${dhamSlug}" min="0" step="any" placeholder="e.g., 2500" disabled></label></div>
            </div>
        </div>`;
}

function getLastMileRows() {
    return Array.from(document.querySelectorAll('[id^="last-mile-row-"]'));
}

// Hide the last-mile table (and its cost note) when every shrine's last mile is entered elsewhere.
function updateLastMileTableVisibility() {
    const hasTableRows = !!lastMileTableBody?.querySelector('tr');
    const table = document.getElementById('lastMileTable');
    const note = document.getElementById('lastMileCostNote');
    if (table) table.style.display = hasTableRows ? '' : 'none';
    if (note) note.style.display = hasTableRows ? '' : 'none';
}

function getMainHaulHelicopterDhams() {
    const dhams = new Set();
    document.querySelectorAll('#primaryModeTable tbody tr[data-dham]').forEach(row => {
        const dham = row.dataset.dham;
        if (!dham || !row.querySelector('input[name^="primaryMode_"][value="Helicopter"]:checked')) return;
        const scope = row.querySelector('input[name^="primaryHelicopterScope_"]:checked')?.value || 'Single Dham shuttle';
        if (scope === 'Complete Char Dham package') {
            getVisitedDhams().filter(name => ['Yamunotri', 'Gangotri', 'Kedarnath', 'Badrinath'].includes(name)).forEach(name => dhams.add(name));
        } else if (scope === 'Do Dham package') {
            getVisitedDhams().filter(name => ['Kedarnath', 'Badrinath'].includes(name)).forEach(name => dhams.add(name));
        } else if (scope === 'Other/private itinerary') {
            row.querySelectorAll('input[name^="primaryHelicopterCoveredDhams_"]:checked').forEach(input => dhams.add(input.value));
            if (!row.querySelector('input[name^="primaryHelicopterCoveredDhams_"]:checked')) dhams.add(dham);
        } else {
            const selectedSingle = row.querySelector('input[name^="primaryHelicopterCoveredDhams_"]:checked')?.value;
            dhams.add(selectedSingle || dham);
        }
    });
    document.querySelectorAll('#interDhamTable tbody tr[data-inter-pair]').forEach(row => {
        const transferModes = Array.from(document.querySelectorAll(`#interDhamTable tbody tr[data-inter-transfer-pair="${row.dataset.interPair}"] input[name^="interDhamTransferMode_"]:checked`));
        const finalMode = transferModes.length
            ? transferModes[transferModes.length - 1].value
            : row.querySelector('input[name^="interDhamMode_"]:checked')?.value || '';
        if (finalMode !== 'Helicopter') return;
        const destination = row.querySelector('input[name^="interDhamTo_"]')?.value || '';
        const dham = getVisitedDhams().find(name => getMainHaulBaseDestination(name) === destination);
        if (dham) dhams.add(dham);
    });
    return dhams;
}

function getLastMileRouteSegment(dham) {
    if (getMainHaulHelicopterDhams().has(dham)) {
        const helicopterRoutes = {
            Kedarnath: 'Kedarnath Helipad → Kedarnath Temple (about 500 m)',
            Badrinath: 'Badrinath Helipad → Badrinath Temple/local stay',
            Gangotri: 'Harsil/Jhalla Helipad → Gangotri Temple',
            Yamunotri: 'Kharsali Helipad → Yamunotri Temple'
        };
        return helicopterRoutes[dham] || `${getHelicopterArrivalPoint(dham)} → ${getDhamShrineDestination(dham)}`;
    }
    const routesByDham = {
        Kedarnath: 'Gaurikund → Kedarnath Temple',
        Badrinath: 'Badrinath road-head → Badrinath Temple',
        Gangotri: 'Gangotri road-head → Gangotri Temple',
        Yamunotri: 'Janki Chatti/Kharsali → Yamunotri Temple',
        'Hemkund Sahib': 'Ghangaria → Hemkund Sahib'
    };
    return routesByDham[dham] || `${dham} route → Temple`;
}
function deleteLastMileRow(dhamSlug) {
    const row = document.getElementById(`last-mile-row-${dhamSlug}`);
    if (row) row.remove();

    if (dhamSlug === 'Kedarnath') {
        const accessChoice = document.getElementById('kedarnathAccessChoice');
        if (accessChoice) accessChoice.style.display = 'none';
        document.querySelectorAll('input[name="kedarnathAccessType"]').forEach(input => {
            input.checked = false;
            input.required = false;
        });
        updateKedarnathAccessUI();
    }
    if (dhamSlug === 'HemkundSahib') {
        const hemkundOnwardCard = document.getElementById('hemkundOnwardCard');
        if (hemkundOnwardCard) hemkundOnwardCard.style.display = 'none';
        document.querySelectorAll('input[name="lastMileApproachMode_HemkundSahib"]').forEach(el => { el.checked = false; });
        ['lastMileApproachTimeBand_HemkundSahib', 'lastMileApproachTime_HemkundSahib', 'lastMileApproachCost_HemkundSahib', 'lastMileApproachWaitingRange_HemkundSahib', 'lastMileApproachWaitingTime_HemkundSahib'].forEach(name => {
            const el = document.querySelector(`[name="${name}"]`);
            if (el) { el.value = ''; if (el.tagName === 'INPUT') el.disabled = true; }
        });
        updateHemkundTaxiDetails();
    }
    
    const checkbox = Array.from(dhamCheckboxes).find(cb => cb.dataset.dham.replace(/\s/g, '') === dhamSlug);
    if(checkbox) checkbox.checked = false;
    updateLastMileReturnSection(getVisitedDhams());
    
    deleteStayDurationRow(dhamSlug);
    updateLastMileTableVisibility();
    updatePrimaryModeTable();
    updateRestLocationTable();
    updateDhamSequenceDropdowns();
    initializeDCE(); // Re-run DCE logic
}

function handleLastMileModeChange(select) {
    updateLastMileCostChoice(select.closest('[id^="last-mile-row-"]'));
}

function updateAccommodationCosts(migrateExact = false) {
    const travelType = document.querySelector('input[name="travelType"]:checked')?.value;
    const basis = travelType === 'Group' ? 'Whole travelling group' : travelType === 'Solo' ? 'Individual' : '';
    document.querySelectorAll('#stayDurationTable tbody tr').forEach(row => {
        const choice = row.querySelector('select[name^="stayAccomCostRange_"]');
        const exact = row.querySelector('input[name^="stayAccomCost_"]');
        const basisInput = row.querySelector('input[name^="stayAccomCostBasis_"]');
        if (!choice || !exact || !basisInput) return;
        if (basisInput.value && basisInput.value !== basis && !restoringDraft) {
            choice.value = '';
            exact.value = '';
        }
        basisInput.value = basis;
        row.querySelector('.accommodation-cost-label').textContent = '';
        if (migrateExact && !choice.value && exact.value !== '') choice.value = 'exact';
        const showExact = choice.value === 'exact';
        exact.closest('label').hidden = !showExact;
        exact.disabled = !showExact;
        exact.required = showExact;
    });
}

function createStayDurationRowHTML(dham) {
    const stayLocation = dham === 'Hemkund Sahib' ? 'Ghangaria' : dham;
    const dhamSlug = dham.replace(/\s/g, '');
    const accomOptions = `<option value="">--Select--</option><option>Hotel</option><option>Dharamsala/Gurudwara</option><option>Guest House</option><option>Ashram</option><option>Tent</option><option>Other</option>`;
    return `
        <tr id="stay-duration-row-${dhamSlug}">
            <td>${stayLocation}${dham === 'Hemkund Sahib' ? '<small class="field-helper">Hemkund Sahib overnight base</small>' : ''}<input type="hidden" name="stayLocation_${dhamSlug}" value="${escapeAttribute(stayLocation)}"></td>
            <td><input type="radio" name="stayDuration_${dhamSlug}" value="<8h" required></td>
            <td><input type="radio" name="stayDuration_${dhamSlug}" value="8-12h"></td>
            <td><input type="radio" name="stayDuration_${dhamSlug}" value="12-18h"></td>
            <td><input type="radio" name="stayDuration_${dhamSlug}" value="18-24h"></td>
            <td><input type="radio" name="stayDuration_${dhamSlug}" value=">24h"></td>
            <td><select name="stayAccom_${dhamSlug}" required>${accomOptions}</select></td>
            <td><label><span class="accommodation-cost-label"></span><select name="stayAccomCostRange_${dhamSlug}" required><option value="">--Choose a range--</option><option>No cost (₹0)</option><option>₹1–₹500</option><option>₹501–₹1,000</option><option>₹1,001–₹2,000</option><option>₹2,001–₹5,000</option><option>₹5,001–₹10,000</option><option>₹10,001–₹20,000</option><option>Over ₹20,000</option><option value="exact">Other / exact amount</option></select></label><label hidden>Exact total cost (₹)<input type="number" name="stayAccomCost_${dhamSlug}" min="0" step="any" placeholder="e.g., 1500" disabled></label><input type="hidden" name="stayAccomCostBasis_${dhamSlug}" value=""></td>
        </tr>`;
}
function deleteStayDurationRow(dhamSlug) {
    const row = document.getElementById(`stay-duration-row-${dhamSlug}`);
    if (row) row.remove();
}

function updateLastMileTable() {
    const visitedDhams = getVisitedDhams();
    const helicopterDhams = getMainHaulHelicopterDhams();
    const lastMileDhams = visitedDhams;
    const showKedarnathApproach = lastMileDhams.includes('Kedarnath') && !helicopterDhams.has('Kedarnath');
    const accessChoice = document.getElementById('kedarnathAccessChoice');
    if (accessChoice) accessChoice.style.display = showKedarnathApproach ? 'block' : 'none';
    document.querySelectorAll('input[name="kedarnathAccessType"]').forEach(input => {
        input.required = showKedarnathApproach;
        if (!showKedarnathApproach) input.checked = false;
    });
    const showHemkundTaxi = lastMileDhams.includes('Hemkund Sahib');
    const hemkundOnwardCard = document.getElementById('hemkundOnwardCard');
    if (hemkundOnwardCard) hemkundOnwardCard.style.display = showHemkundTaxi ? 'block' : 'none';
    const existingRows = new Set(getLastMileRows().map(row => row.id.replace('last-mile-row-', '')));

    lastMileDhams.forEach(dham => {
        const dhamSlug = dham.replace(/\s/g, '');
        if (!existingRows.has(dhamSlug)) {
            const rowParent = dham === 'Hemkund Sahib' ? document.getElementById('hemkundLeg3Slot') : lastMileTableBody;
            rowParent.insertAdjacentHTML('beforeend', createLastMileRowHTML(dham));
            if (!document.getElementById(`stay-duration-row-${dhamSlug}`)) {
                stayDurationTableBody.insertAdjacentHTML('beforeend', createStayDurationRowHTML(dham));
            }
            lockEnglishOptionValues(document.getElementById(`last-mile-row-${dhamSlug}`));
            lockEnglishOptionValues(stayDurationTableBody.querySelector(`#stay-duration-row-${dhamSlug}`));
            initializeOtherSpecifyFields(document.getElementById(`last-mile-row-${dhamSlug}`));
            initializeOtherSpecifyFields(stayDurationTableBody.querySelector(`#stay-duration-row-${dhamSlug}`));
        }
        const row = document.getElementById(`last-mile-row-${dhamSlug}`);
        const routeValue = getLastMileRouteSegment(dham);
        const routeLabel = row?.querySelector('.last-mile-route-label');
        const routeInput = row?.querySelector(`input[name="lastMileRoute_${dhamSlug}"]`);
        if (routeLabel) routeLabel.textContent = routeValue;
        if (routeInput) routeInput.value = routeValue;
        const modeSelect = row?.querySelector(`select[name="lastMileMode_${dhamSlug}"]`);
        if (modeSelect) {
            const previous = modeSelect.value;
            const modeOptions = helicopterDhams.has(dham)
                ? getHelipadLastMileModeOptionsHTML(dham) : getLastMileModeOptionsHTML(dham);
            modeSelect.innerHTML = modeOptions;
            if (Array.from(modeSelect.options).some(option => option.value === previous)) modeSelect.value = previous;
        }
    });

    existingRows.forEach(dhamSlug => {
        // Find the original shrine name (with spaces) to check against visitedDhams
        const dhamName = Array.from(dhamCheckboxes).find(cb => cb.dataset.dham.replace(/\s/g, '') === dhamSlug)?.dataset.dham;
        
        if (dhamName && !lastMileDhams.includes(dhamName)) {
            deleteLastMileRow(dhamSlug);
        }
    });
    updateKedarnathAccessUI();
    updateHemkundTaxiDetails();
    updateLastMileTableVisibility();
    updateLastMileReturnSection(lastMileDhams);
    updateAccommodationCosts();
}

function getLastMileReturnModeOptionsHTML(dham) {
    if (getMainHaulHelicopterDhams().has(dham)) {
        return getHelipadLastMileModeOptionsHTML(dham);
    }
    if (dham === 'Kedarnath') {
        return `<option value="">--Select--</option><option>Trek/Walk</option><option>Pony/Mule</option><option>Palki/Dandi</option><option>Helicopter</option><option>Other</option>`;
    }
    return getLastMileModeOptionsHTML(dham);
}

const RETURN_MOUNTAIN_MODES = ['Trek/Walk', 'Pony/Mule', 'Palki/Dandi', 'Pithu / Kandi', 'Other'];
const RETURN_SHORT_TIME_BANDS = ['Under 15 min', '15–30 min', '31–60 min', '1–2 hr', 'Over 2 hr'];
const HEMKUND_PULNA_TIME_BANDS = ['Under 2 hr', '2–3 hr', '3–4 hr', '4–6 hr', '6–8 hr', '8–10 hr', 'Over 10 hr'];

// Route choices offered when the return differs from the onward journey.
function getLastMileReturnRouteOptions(dham) {
    if (dham === 'Kedarnath') {
        return [['Trek route', 'Trek route: Gaurikund → Sonprayag'], ['Helicopter', 'Helicopter to a helipad']];
    }
    return [];
}

// Return legs in travel order (shrine → base). Leg 1 keeps the original field names.
function getLastMileReturnLegDefs(dham, slug) {
    if (dham === 'Kedarnath') {
        const route = document.querySelector(`input[name="lastMileReturnRoute_${slug}"]:checked`)?.value || '';
        if (route === 'Helicopter') {
            const helipad = document.querySelector(`select[name="lastMileReturnHelipad_${slug}"]`);
            const helipadName = helipad?.value === 'Other'
                ? (document.querySelector(`input[name="lastMileReturnHelipad_${slug}_otherSpecify"]`)?.value || 'Other helipad')
                : (helipad?.value || 'Helipad');
            return [{ from: 'Kedarnath Temple', to: helipadName, modes: ['Helicopter'], times: ['Under 15 min', '15–30 min', 'Over 30 min'], helipad: true }];
        }
        if (route === 'Trek route') {
            return [
                { from: 'Kedarnath Temple', to: 'Gaurikund', modes: RETURN_MOUNTAIN_MODES, times: getLastMileTimeBands('Kedarnath') },
                { from: 'Gaurikund', to: 'Sonprayag', modes: ['Government-operated shuttle', 'Walk', 'Other'], times: RETURN_SHORT_TIME_BANDS }
            ];
        }
        return [];
    }
    if (dham === 'Hemkund Sahib') {
        return [
            { from: 'Hemkund Sahib', to: 'Ghangaria', modes: RETURN_MOUNTAIN_MODES, times: getLastMileTimeBands('Hemkund Sahib') },
            { from: 'Ghangaria', to: 'Pulna', modes: RETURN_MOUNTAIN_MODES, times: HEMKUND_PULNA_TIME_BANDS },
            { from: 'Pulna', to: 'Govindghat', modes: ['Shared Taxi / Shuttle', 'Walk', 'Other'], times: RETURN_SHORT_TIME_BANDS }
        ];
    }
    const [onwardFrom, onwardTo] = getLastMileRouteSegment(dham).split('→').map(value => value.trim());
    const modes = Array.from(new DOMParser().parseFromString(`<select>${getLastMileReturnModeOptionsHTML(dham)}</select>`, 'text/html').querySelectorAll('option'))
        .map(option => option.value || option.textContent).filter(Boolean);
    return [{ from: onwardTo || getDhamShrineDestination(dham), to: onwardFrom || getReturnJourneyOrigin(dham), modes, times: getLastMileTimeBands(dham) }];
}

function getReturnLegSuffix(index) {
    return index === 0 ? '' : `_Leg${index + 1}`;
}

function createLastMileReturnLegHTML(dham, slug, leg, index) {
    const sfx = getReturnLegSuffix(index);
    const single = leg.modes.length === 1;
    const modeOptions = (single ? '' : '<option value="">--Select--</option>')
        + leg.modes.map(mode => `<option value="${escapeAttribute(mode)}"${single ? ' selected' : ''}>${escapeHTML(mode)}</option>`).join('');
    const timeOptions = leg.times.map(band => `<option value="${escapeAttribute(band)}">${escapeHTML(band)}</option>`).join('');
    const helipadField = leg.helipad
        ? `<label>Landing helipad<select name="lastMileReturnHelipad_${slug}"><option value="">--Select--</option><option>Phata</option><option>Sersi</option><option>Guptkashi</option><option>Other</option></select></label>`
        : '';
    return `<div class="return-leg" data-leg="${index + 1}">
        <div class="return-leg-title">Return leg ${index + 1}: <span class="return-leg-route">${escapeHTML(`${leg.from} → ${leg.to}`)}</span></div>
        <input type="hidden" name="lastMileReturnLegRoute_${slug}${sfx}" value="${escapeAttribute(`${leg.from} → ${leg.to}`)}">
        <div class="return-leg-fields">
            ${helipadField}
            <label>Mode<select name="lastMileReturnMode_${slug}${sfx}">${modeOptions}</select></label>
            <div class="return-field-group">
                <label>Time<select name="lastMileReturnTimeBand_${slug}${sfx}"><option value="">--Choose time band--</option>${timeOptions}<option value="exact">Other / exact hours</option></select></label>
                <label style="display:none">Exact time (hours)<input type="number" name="lastMileReturnTime_${slug}${sfx}" min="0" step="any" placeholder="e.g., 3"></label>
            </div>
            <div class="return-field-group">
                <label>Cost per person<select name="lastMileReturnCostBand_${slug}${sfx}"><option value="">--Select mode first--</option></select></label>
                <label style="display:none">Exact cost per person (₹)<input type="number" name="lastMileReturnCost_${slug}${sfx}" min="0" placeholder="e.g., 1500"></label>
            </div>
        </div>
    </div>`;
}

function createLastMileReturnCardHTML(dham) {
    const slug = getDhamSlug(dham);
    const routeOptions = getLastMileReturnRouteOptions(dham);
    const routeQuestion = routeOptions.length
        ? `<div class="return-route-choice"><div class="hemkund-field-title">How did you come back?</div><div class="answer-buttons">${routeOptions.map(([value, label]) =>
            `<label class="answer-choice"><input type="radio" name="lastMileReturnRoute_${slug}" value="${escapeAttribute(value)}"><span>${escapeHTML(label)}</span></label>`).join('')}</div></div>`
        : '';
    return `<fieldset class="answer-question last-mile-return-card" id="last-mile-return-${slug}" data-dham="${escapeAttribute(dham)}">
        <legend>${escapeHTML(dham)}: return journey</legend>
        <p class="field-helper last-mile-return-route"></p>
        <div class="answer-buttons">
            <label class="answer-choice"><input type="radio" name="lastMileReturnType_${slug}" value="Same as onward" required><span>Same as onward</span></label>
            <label class="answer-choice"><input type="radio" name="lastMileReturnType_${slug}" value="Different"><span>Different mode or route</span></label>
            <label class="answer-choice"><input type="radio" name="lastMileReturnType_${slug}" value="Not completed"><span>Return not completed</span></label>
        </div>
        <div class="last-mile-return-details" id="last-mile-return-details-${slug}" style="display:none;">
            ${routeQuestion}
            <p class="field-helper last-mile-return-leg">Enter each part of your return journey from the shrine.</p>
            <div class="last-mile-return-legs"></div>
        </div>
    </fieldset>`;
}

function updateLastMileReturnSection(visitedDhams = getVisitedDhams()) {
    const container = document.getElementById('lastMileReturnSection');
    if (!container) return;
    container.querySelectorAll('.last-mile-return-card').forEach(card => {
        const slug = card.id.replace('last-mile-return-', '');
        if (!visitedDhams.some(dham => getDhamSlug(dham) === slug)) card.remove();
    });
    visitedDhams.forEach(dham => {
        const slug = getDhamSlug(dham);
        const existing = document.getElementById(`last-mile-return-${slug}`);
        if (existing && !existing.querySelector('.last-mile-return-legs')) existing.remove();
        if (!document.getElementById(`last-mile-return-${slug}`)) {
            container.insertAdjacentHTML('beforeend', createLastMileReturnCardHTML(dham));
        }
        updateLastMileReturnDetails(slug);
    });
}

function updateLastMileReturnDetails(slug, migrateExact = false) {
    const card = document.getElementById(`last-mile-return-${slug}`);
    const details = document.getElementById(`last-mile-return-details-${slug}`);
    if (!card || !details) return;
    const dham = card.dataset.dham;
    const isDifferent = card.querySelector(`input[name="lastMileReturnType_${slug}"]:checked`)?.value === 'Different';
    details.style.display = isDifferent ? 'block' : 'none';

    details.querySelectorAll(`input[name="lastMileReturnRoute_${slug}"]`).forEach(input => {
        input.disabled = !isDifferent;
        input.required = isDifferent;
        if (!isDifferent) input.checked = false;
    });

    // Rebuild the leg rows only when the route itself changes, so typed answers survive.
    const legs = getLastMileReturnLegDefs(dham, slug);
    const legsBox = details.querySelector('.last-mile-return-legs');
    const signature = legs.map(leg => `${leg.helipad ? 'heli' : leg.from}|${leg.modes.join(',')}`).join(';');
    if (legsBox.dataset.signature !== signature) {
        legsBox.innerHTML = legs.map((leg, index) => createLastMileReturnLegHTML(dham, slug, leg, index)).join('');
        legsBox.dataset.signature = signature;
        lockEnglishOptionValues(legsBox);
    }
    const legNote = details.querySelector('.last-mile-return-leg');
    if (legNote) legNote.textContent = legs.length ? 'Enter each part of your return journey from the shrine.' : 'Choose how you came back to see the return legs.';

    legsBox.querySelectorAll('.return-leg').forEach((legEl, index) => {
        const leg = legs[index];
        const sfx = getReturnLegSuffix(index);
        const q = name => legEl.querySelector(`[name="${name}_${slug}${sfx}"]`);
        const modeSelect = q('lastMileReturnMode');
        const timeBand = q('lastMileReturnTimeBand');
        const timeExact = q('lastMileReturnTime');
        const costBand = q('lastMileReturnCostBand');
        const costExact = q('lastMileReturnCost');
        const routeInput = q('lastMileReturnLegRoute');
        const helipad = legEl.querySelector(`select[name="lastMileReturnHelipad_${slug}"]`);

        if (leg && routeInput) {
            routeInput.value = `${leg.from} → ${leg.to}`;
            legEl.querySelector('.return-leg-route').textContent = routeInput.value;
        }
        if (routeInput) routeInput.disabled = !isDifferent;
        if (helipad) {
            helipad.disabled = !isDifferent;
            helipad.required = isDifferent;
            if (isDifferent) updateOtherSpecifyField(helipad);
        }
        [modeSelect, timeBand].forEach(ctrl => { ctrl.disabled = !isDifferent; ctrl.required = isDifferent; });

        // Cost bands follow the leg's mode; changing mode clears the previous cost. Walking is ₹0.
        const mode = modeSelect.value;
        const isWalk = mode === 'Trek/Walk' || mode === 'Walk';
        if (costBand.dataset.mode !== mode) {
            const previous = costBand.value;
            const bands = mode ? getLastMileCostBands(dham, isWalk ? 'Trek/Walk' : mode) : [];
            costBand.innerHTML = `<option value="">${mode ? '--Choose cost range--' : '--Select mode first--'}</option>`
                + bands.map(band => `<option value="${escapeAttribute(band)}">${escapeHTML(band)}</option>`).join('')
                + (mode && !isWalk ? '<option value="exact">Other / exact amount</option>' : '');
            const keepPrevious = restoringDraft || costBand.dataset.mode === undefined;
            if (keepPrevious && Array.from(costBand.options).some(option => option.value === previous)) costBand.value = previous;
            if (!keepPrevious) costExact.value = '';
            costBand.dataset.mode = mode;
        }
        if (isWalk) costBand.value = 'No cost (₹0)';
        costBand.disabled = !isDifferent;
        costBand.required = isDifferent;

        if (migrateExact && !timeBand.value && timeExact.value) timeBand.value = 'exact';
        const showTimeExact = isDifferent && timeBand.value === 'exact';
        timeExact.closest('label').style.display = showTimeExact ? '' : 'none';
        timeExact.disabled = !showTimeExact;
        timeExact.required = showTimeExact;
        if (!showTimeExact) timeExact.value = '';

        if (migrateExact && !costBand.value && costExact.value && !isWalk) costBand.value = 'exact';
        const showCostExact = isDifferent && !isWalk && costBand.value === 'exact';
        costExact.closest('label').style.display = showCostExact ? '' : 'none';
        if (isDifferent && isWalk) costExact.value = '0';
        else if (!showCostExact) costExact.value = '';
        // Walking keeps the hidden ₹0 enabled so it is still submitted.
        costExact.disabled = !(isDifferent && (isWalk || showCostExact));
        costExact.required = showCostExact;

        const otherInput = legEl.querySelector(`input[name="lastMileReturnMode_${slug}${sfx}_otherSpecify"]`);
        if (isDifferent) updateOtherSpecifyField(modeSelect);
        else if (otherInput) { otherInput.required = false; otherInput.value = ''; }
    });
}

// Values of the return legs entered on a "Different" return, for the route preview.
function getLastMileReturnLegValues(slug) {
    return Array.from(document.querySelectorAll(`#last-mile-return-${slug} .return-leg`)).map((legEl, index) => {
        const sfx = getReturnLegSuffix(index);
        const value = name => legEl.querySelector(`[name="${name}_${slug}${sfx}"]`)?.value || '';
        const [from, to] = value('lastMileReturnLegRoute').split('→').map(part => part.trim());
        const timeBand = value('lastMileReturnTimeBand');
        const costBand = value('lastMileReturnCostBand');
        return {
            from, to,
            mode: value('lastMileReturnMode'),
            time: timeBand === 'exact' ? value('lastMileReturnTime') : '',
            timeLabel: timeBand !== 'exact' ? timeBand : '',
            cost: costBand === 'exact' ? value('lastMileReturnCost') : '',
            costLabel: costBand !== 'exact' ? costBand : ''
        };
    });
}

function updateModeBlockVisibility(mode) {
    const gate = document.querySelector(`input[name="${mode}Gate"]:checked`)?.value;
    const block = document.getElementById(`${mode}ModeBlock`);
    if (!block) return;
    const show = gate === 'yes' || gate === 'maybe';
    block.style.display = show ? '' : 'none';
    block.querySelectorAll('input, select, textarea').forEach(el => {
        if (!show) {
            el.disabled = true;
            if (el.type !== 'radio' && el.type !== 'checkbox') el.value = '';
            if (el.type === 'radio' || el.type === 'checkbox') el.checked = false;
        } else {
            el.disabled = false;
        }
    });

    // Show/hide "reason for not using" block
    const noReasonBlock = document.getElementById(`${mode}NoReasonBlock`);
    if (noReasonBlock) {
        const showReason = gate === 'no';
        noReasonBlock.style.display = showReason ? '' : 'none';
        noReasonBlock.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.disabled = !showReason;
            if (!showReason) cb.checked = false;
        });
        const otherText = noReasonBlock.querySelector(`input[name="${mode}NoReasonOtherText"]`);
        if (otherText) {
            otherText.disabled = !showReason;
            if (!showReason) otherText.value = '';
        }
    }

    // Show/hide D2c cost threshold block (rail only, yes + maybe)
    const maybeBlock = document.getElementById(`${mode}MaybeBlock`);
    if (maybeBlock) {
        const showMaybe = gate === 'yes' || gate === 'maybe';
        maybeBlock.style.display = showMaybe ? '' : 'none';
        maybeBlock.querySelectorAll('select').forEach(sel => {
            sel.disabled = !showMaybe;
            if (!showMaybe) sel.value = '';
        });
    }
}


function updateKedarnathAccessUI() {
    const accessType = document.querySelector('input[name="kedarnathAccessType"]:checked')?.value || '';
    const isRoadRoute = accessType === 'Via Sonprayag and Gaurikund';
    const isHelicopter = accessType === 'Helicopter from helipad';
    const approachQuestion = document.getElementById('kedarnathApproachQuestion');
    const helicopterDetails = document.getElementById('kedarnathHelicopterDetails');
    const kedarnathRow = document.getElementById('last-mile-row-Kedarnath');

    if (approachQuestion) approachQuestion.style.display = isRoadRoute ? 'block' : 'none';
    document.querySelectorAll('input[name="lastMileApproachMode_Kedarnath"]').forEach(input => {
        input.required = isRoadRoute;
        input.disabled = !isRoadRoute;
        if (!isRoadRoute) input.checked = false;
    });

    if (helicopterDetails) helicopterDetails.style.display = isHelicopter ? 'block' : 'none';
    if (helicopterDetails) helicopterDetails.querySelectorAll('select[name="kedarnathHelicopterBoardingPoint"], input[name="kedarnathHelicopterTime"], input[name="kedarnathHelicopterCost"], input[name="kedarnathHelicopterWaitingTime"]').forEach(control => {
        control.required = isHelicopter;
        control.disabled = !isHelicopter;
    });
    const boardingSelect = document.querySelector('select[name="kedarnathHelicopterBoardingPoint"]');
    const otherHelipad = document.querySelector('input[name="kedarnathHelicopterBoardingPoint_otherSpecify"]');
    if (otherHelipad) {
        otherHelipad.disabled = !isHelicopter;
        if (!isHelicopter) otherHelipad.required = false;
    }
    if (isHelicopter && boardingSelect) updateOtherSpecifyField(boardingSelect);

    if (kedarnathRow) {
        kedarnathRow.style.display = isRoadRoute ? '' : 'none';
        kedarnathRow.querySelectorAll('select, input[type="number"]').forEach(control => {
            control.required = isRoadRoute;
            control.disabled = !isRoadRoute;
        });
        updateLastMileTimeChoice(kedarnathRow);
        updateLastMileCostChoice(kedarnathRow);
    }
    updateKedarnathApproachDetails();
}

function updateHemkundTaxiDetails() {
    updateHemkundMountainDetails();
    const mode = document.querySelector('input[name="lastMileApproachMode_HemkundSahib"]:checked')?.value || '';
    const isTaxi = mode === 'Shared Taxi / Shuttle';
    const isWalk = mode === 'Walk';
    const showDetails = isTaxi || isWalk;

    const grid = document.getElementById('hemkundApproachDetailGrid');
    if (grid) grid.style.display = showDetails ? 'grid' : 'none';

    const timeLabel = document.getElementById('hemkundApproachTimeLabel');
    if (timeLabel) {
        const textNode = timeLabel.firstChild;
        if (textNode?.nodeType === Node.TEXT_NODE) textNode.nodeValue = isWalk ? 'Walking time\n                ' : 'Travel time\n                ';
    }

    const timeBand = document.querySelector('select[name="lastMileApproachTimeBand_HemkundSahib"]');
    const timeExactLabel = document.getElementById('hemkundApproachTimeExactLabel');
    const timeInput = document.querySelector('input[name="lastMileApproachTime_HemkundSahib"]');
    if (timeBand) { timeBand.required = showDetails; timeBand.disabled = !showDetails; if (!showDetails) timeBand.value = ''; }
    const showTimeExact = showDetails && timeBand?.value === 'exact';
    if (timeExactLabel) timeExactLabel.style.display = showTimeExact ? '' : 'none';
    if (timeInput) { timeInput.required = showTimeExact; timeInput.disabled = !showTimeExact; if (!showTimeExact) timeInput.value = ''; }

    const costLabel = document.getElementById('hemkundTaxiCostLabel');
    const costInput = document.querySelector('input[name="lastMileApproachCost_HemkundSahib"]');
    if (costLabel) costLabel.style.display = isTaxi ? '' : 'none';
    if (costInput) {
        costInput.required = isTaxi;
        costInput.disabled = !isTaxi;
        costInput.readOnly = true;
        costInput.value = isTaxi ? '60' : '';
    }

    const waitingLabel = document.getElementById('hemkundWaitingLabel');
    const range = document.querySelector('select[name="lastMileApproachWaitingRange_HemkundSahib"]');
    if (waitingLabel) waitingLabel.style.display = isTaxi ? '' : 'none';
    if (range && !isTaxi) range.value = '';

    const showExact = isTaxi && range?.value === 'exact';
    const exactLabel = document.getElementById('hemkundExactWaitingLabel');
    const exact = document.querySelector('input[name="lastMileApproachWaitingTime_HemkundSahib"]');
    if (exactLabel) exactLabel.style.display = showExact ? '' : 'none';
    if (exact) { exact.required = showExact; exact.disabled = !showExact; if (!showExact) exact.value = ''; }
}

function updateHemkundMountainDetails() {
    const active = !!document.getElementById('last-mile-row-HemkundSahib');
    const details = document.getElementById('hemkundMountainDetails');
    if (!details) return;
    details.style.display = active ? 'block' : 'none';
    const destination = details.querySelector('[name="lastMileApproachDestination_HemkundSahib"]:checked');
    const viaGhangaria = destination?.value !== 'Hemkund Sahib';
    details.querySelectorAll('input, select').forEach(control => {
        control.disabled = !active;
        control.required = active && !control.name.endsWith('_otherSpecify');
        if (!active) { if (control.type === 'radio') control.checked = false; else control.value = ''; }
    });
    const mountainTimeBand = details.querySelector('[name="lastMileApproachMountainTimeBand_HemkundSahib"]');
    const mountainTimeExact = details.querySelector('[name="lastMileApproachMountainTime_HemkundSahib"]');
    if (restoringDraft && mountainTimeBand && !mountainTimeBand.value && mountainTimeExact?.value) mountainTimeBand.value = 'exact';
    const showMountainTimeExact = active && mountainTimeBand?.value === 'exact';
    document.getElementById('hemkundMountainTimeExactLabel').style.display = showMountainTimeExact ? '' : 'none';
    if (mountainTimeExact) {
        mountainTimeExact.disabled = !showMountainTimeExact;
        mountainTimeExact.required = showMountainTimeExact;
        if (!showMountainTimeExact) mountainTimeExact.value = '';
    }
    // Cost bands follow the selected mode (same Hemkund bands as the Ghangaria → Hemkund row);
    // changing mode clears the previous cost. Walk is fixed at ₹0.
    const mountainMode = details.querySelector('[name="lastMileApproachMountainMode_HemkundSahib"]:checked')?.value || '';
    const walk = mountainMode === 'Trek/Walk';
    const costBand = details.querySelector('[name="lastMileApproachMountainCostBand_HemkundSahib"]');
    const cost = details.querySelector('[name="lastMileApproachMountainCost_HemkundSahib"]');
    if (costBand && costBand.dataset.mode !== mountainMode) {
        const previous = costBand.value;
        const bands = mountainMode ? getLastMileCostBands('Hemkund Sahib', mountainMode) : [];
        costBand.innerHTML = `<option value="">${mountainMode ? '-- Choose a cost range --' : '-- Select mode first --'}</option>`
            + bands.map(band => `<option value="${escapeAttribute(band)}">${escapeHTML(band)}</option>`).join('')
            + (mountainMode && !walk ? '<option value="exact">Other / exact amount</option>' : '');
        const keepPrevious = restoringDraft || costBand.dataset.mode === undefined;
        if (keepPrevious && Array.from(costBand.options).some(option => option.value === previous)) costBand.value = previous;
        if (!keepPrevious && cost) cost.value = '';
        costBand.dataset.mode = mountainMode;
    }
    if (costBand && walk) costBand.value = 'No cost (₹0)';
    if (restoringDraft && costBand && !costBand.value && cost?.value && !walk) costBand.value = 'exact';
    const showCostExact = active && !walk && costBand?.value === 'exact';
    document.getElementById('hemkundMountainCostExactLabel').style.display = showCostExact ? '' : 'none';
    if (cost) {
        if (walk) cost.value = '0';
        else if (!showCostExact) cost.value = '';
        // Walk keeps the hidden ₹0 enabled so it is still submitted.
        cost.disabled = !(active && (walk || showCostExact));
        cost.required = showCostExact;
    }
    details.querySelectorAll('[name="lastMileApproachStop_HemkundSahib"]').forEach(stop => {
        stop.disabled = !active || !viaGhangaria;
        stop.required = active && viaGhangaria;
        if (stop.disabled) stop.checked = false;
    });
    document.getElementById('hemkundGhangariaStopLabel').hidden = !viaGhangaria;
    const leg2Route = document.getElementById('hemkundLeg2Route');
    if (leg2Route) leg2Route.textContent = viaGhangaria ? 'Pulna → Ghangaria' : 'Pulna → Hemkund Sahib';
    const row = document.getElementById('last-mile-row-HemkundSahib');
    if (row) {
        row.style.display = viaGhangaria ? '' : 'none';
        row.querySelectorAll('input, select').forEach(control => {
            control.disabled = !viaGhangaria;
            control.required = viaGhangaria && control.tagName === 'SELECT';
        });
        updateLastMileTimeChoice(row);
        updateLastMileCostChoice(row);
    }
}

function updateKedarnathApproachDetails() {
    const panel = document.getElementById('kedarnathShuttleDetails');
    if (!panel) return;
    const isRoadRoute = document.querySelector('input[name="kedarnathAccessType"]:checked')?.value === 'Via Sonprayag and Gaurikund';
    const modeVal = document.querySelector('input[name="lastMileApproachMode_Kedarnath"]:checked')?.value || '';
    const isShuttle = isRoadRoute && modeVal === 'Government-operated shuttle';
    const isWalk = isRoadRoute && modeVal === 'Walk';
    const showPanel = isShuttle || isWalk;

    panel.style.display = showPanel ? 'grid' : 'none';

    const timeLabel = document.getElementById('kedarnathApproachTimeLabel');
    if (timeLabel) {
        const textNode = timeLabel.firstChild;
        if (textNode?.nodeType === Node.TEXT_NODE) textNode.nodeValue = isWalk ? 'Walking time\n                ' : 'Travel time\n                ';
    }

    const timeBand = panel.querySelector('select[name="lastMileApproachTimeBand_Kedarnath"]');
    const timeExactLabel = document.getElementById('kedarnathApproachTimeExactLabel');
    const timeInput = panel.querySelector('input[name="lastMileApproachTime_Kedarnath"]');
    if (timeBand) { timeBand.required = showPanel; timeBand.disabled = !showPanel; if (!showPanel) timeBand.value = ''; }
    const showTimeExact = showPanel && timeBand?.value === 'exact';
    if (timeExactLabel) timeExactLabel.style.display = showTimeExact ? '' : 'none';
    if (timeInput) { timeInput.required = showTimeExact; timeInput.disabled = !showTimeExact; if (!showTimeExact) timeInput.value = ''; }

    const costLabel = document.getElementById('kedarnathApproachCostLabel');
    if (costLabel) costLabel.style.display = isShuttle ? '' : 'none';

    const waitingLabel = document.getElementById('kedarnathApproachWaitingLabel');
    const range = panel.querySelector('select[name="lastMileApproachWaitingRange_Kedarnath"]');
    if (waitingLabel) waitingLabel.style.display = isShuttle ? '' : 'none';
    if (!isShuttle && range) range.value = '';

    const showExact = isShuttle && range?.value === 'exact';
    const exactLabel = document.getElementById('kedarnathExactWaitingLabel');
    const exact = panel.querySelector('input[name="lastMileApproachWaitingTime_Kedarnath"]');
    if (exactLabel) exactLabel.style.display = showExact ? '' : 'none';
    if (exact) { exact.required = showExact; exact.disabled = !showExact; if (!showExact) exact.value = ''; }
}

function updateDhamSequenceDropdowns() {
    const visitedDhams = getVisitedDhams();
    const container = document.getElementById('dhamSequenceSelection');
    const previousSelections = Array.from(container.querySelectorAll('select[name^="dhamSequence_"]'))
        .map(select => select.value)
        .filter(value => visitedDhams.includes(value));
    
    if (visitedDhams.length === 0) {
        container.innerHTML = '<h4>Order of Shrine Visits</h4><p style="color: grey;">Select Shrines in A2 to show visit-order fields.</p>';
        return;
    }

    if (visitedDhams.length === 1) {
        container.innerHTML = `<h4>Order of Shrine Visits</h4><p style="color: grey;">Only ${escapeHTML(visitedDhams[0])} selected. No order needed.</p>`;
        return;
    }
    
    let html = '<h4>Order of Shrine Visits</h4><p class="field-helper">Choose your first stop, then your next stops in order.</p><div class="dham-sequence-grid">';

    for (let i = 0; i < visitedDhams.length; i++) {
        const selectedDham = previousSelections[i] || '';
        html += `
            <label><span class="visit-number">${i + 1}</span> ${i === 0 ? 'First stop' : 'Next stop'}
                <select name="dhamSequence_${i + 1}" data-selected-dham="${escapeAttribute(selectedDham)}" required>
                </select>
            </label>`;
    }
    container.innerHTML = html + '</div>';
    container.querySelectorAll('select[name^="dhamSequence_"]').forEach(select => {
        select.value = select.dataset.selectedDham || '';
    });
    refreshDhamSequenceOptions();
}

function refreshDhamSequenceOptions() {
    const visitedDhams = getVisitedDhams();
    const selects = Array.from(document.querySelectorAll('select[name^="dhamSequence_"]'));
    const selectedValues = selects.map(select => select.value || select.dataset.selectedDham || '').filter(Boolean);

    selects.forEach(select => {
        const currentValue = select.value || select.dataset.selectedDham || '';
        const unavailableValues = new Set(selectedValues.filter(value => value !== currentValue));
        let options = '<option value="">--Select Shrine--</option>';

        visitedDhams.forEach(dham => {
            if (!unavailableValues.has(dham)) {
                const selected = dham === currentValue ? ' selected' : '';
                options += `<option value="${escapeAttribute(dham)}"${selected}>${escapeHTML(dham)}</option>`;
            }
        });

        select.innerHTML = options;
        select.dataset.selectedDham = currentValue;
    });
    lockEnglishOptionValues(document.getElementById('dhamSequenceSelection'));
}

function handleBudgetScopeChange() {
    const scope = document.querySelector('input[name="transportBudgetBasis"]:checked')?.value;
    const perBlock   = document.getElementById('budgetPerPersonBlock');
    const groupBlock = document.getElementById('budgetGroupBlock');
    // Clear any previous selection in the block being hidden
    if (scope === 'Per person') {
        document.querySelectorAll('input[name="transportBudgetGroup"]').forEach(r => r.checked = false);
        if (perBlock)   perBlock.style.display   = '';
        if (groupBlock) groupBlock.style.display  = 'none';
    } else if (scope === 'Whole group') {
        document.querySelectorAll('input[name="transportBudget"]').forEach(r => r.checked = false);
        if (perBlock)   perBlock.style.display   = 'none';
        if (groupBlock) groupBlock.style.display  = '';
    }
}

function handleTravelTypeChange() {
    updateAccommodationCosts();
    const travelType = document.querySelector('input[name="travelType"]:checked')?.value;
    const budgetScopeBlock = document.getElementById('budgetScopeBlock');
    const perBlock         = document.getElementById('budgetPerPersonBlock');
    const groupBlock       = document.getElementById('budgetGroupBlock');
    if (travelType === 'Solo') {
        if (budgetScopeBlock) budgetScopeBlock.style.display = 'none';
        if (perBlock)         perBlock.style.display         = '';
        if (groupBlock)       groupBlock.style.display       = 'none';
        document.querySelectorAll('input[name="transportBudgetBasis"]').forEach(r => r.checked = false);
        document.querySelectorAll('input[name="transportBudgetGroup"]').forEach(r => r.checked = false);
    } else if (travelType === 'Group') {
        if (budgetScopeBlock) budgetScopeBlock.style.display = '';
        if (perBlock)         perBlock.style.display         = 'none';
        if (groupBlock)       groupBlock.style.display       = 'none';
        document.querySelectorAll('input[name="transportBudgetBasis"]').forEach(r => r.checked = false);
        document.querySelectorAll('input[name="transportBudget"]').forEach(r => r.checked = false);
        document.querySelectorAll('input[name="transportBudgetGroup"]').forEach(r => r.checked = false);
    }
    const groupSizeInput = document.getElementById('groupSize');
    const groupSizeLabel = document.getElementById('groupSizeLabel');
    const groupSizeHelper = document.getElementById('groupSizeHelper');
    const groupCompositionFields = document.getElementById('groupCompositionFields');
    const assistanceQuestionText = document.getElementById('specialAssistanceRequirementText');
    const assistanceSelect = document.querySelector('select[name="specialAssistanceRequirement"]');
    const anotherMemberOption = assistanceSelect
        ? Array.from(assistanceSelect.options).find(option => option.textContent.trim() === 'Yes - for another group member')
        : null;

    if (!travelType) {
        if (groupSizeLabel) groupSizeLabel.style.display = 'none';
        if (groupSizeHelper) groupSizeHelper.style.display = 'none';
        if (groupCompositionFields) groupCompositionFields.style.display = 'none';
        validateGroupComposition();
        return;
    }
    
    if (travelType === 'Solo') {
        groupSizeInput.value = 1;
        groupSizeInput.readOnly = true;
        if (groupSizeLabel) {
            groupSizeLabel.style.display = 'none';
        }
        if (groupSizeHelper) {
            groupSizeHelper.style.display = 'none';
        }
        if (assistanceQuestionText) {
            assistanceQuestionText.textContent = 'Need mobility assistance?';
        }
        if (anotherMemberOption) {
            anotherMemberOption.hidden = true;
            anotherMemberOption.disabled = true;
            if (assistanceSelect.value === anotherMemberOption.value) {
                assistanceSelect.value = '';
            }
        }
        if (groupCompositionFields) {
            groupCompositionFields.style.display = 'none';
            groupCompositionFields.querySelectorAll('input').forEach(input => {
                input.value = '';
                input.style.border = '';
            });
        }
    } else {
        groupSizeInput.readOnly = false;
        if (groupSizeLabel) {
            groupSizeLabel.style.display = '';
        }
        if (groupSizeHelper) {
            groupSizeHelper.style.display = '';
        }
        if (assistanceQuestionText) {
            assistanceQuestionText.textContent = 'Anyone in your group need mobility assistance?';
        }
        if (anotherMemberOption) {
            anotherMemberOption.hidden = false;
            anotherMemberOption.disabled = false;
        }
        if (groupSizeInput.value === '1') {
             groupSizeInput.value = 2; 
        }
        if (groupCompositionFields) {
            groupCompositionFields.style.display = 'block';
        }
    }
    
    validateGroupComposition();
}

function getGroupCompositionInputs() {
    return Array.from(document.querySelectorAll('#groupCompositionFields input[type="number"]'));
}

function validateGroupComposition() {
    const travelType = document.querySelector('input[name="travelType"]:checked')?.value;
    const groupSizeInput = document.getElementById('groupSize');
    const groupCompositionFields = document.getElementById('groupCompositionFields');
    const message = document.getElementById('groupCompositionMessage');

    if (!groupSizeInput || !groupCompositionFields || !message || travelType !== 'Group') {
        return true;
    }

    const groupSize = Number(groupSizeInput.value) || 0;
    const inputs = getGroupCompositionInputs();
    const compositionTotal = inputs.reduce((sum, input) => sum + (Number(input.value) || 0), 0);
    const hasCompositionInput = inputs.some(input => input.value !== '');
    const isValid = !hasCompositionInput || compositionTotal <= groupSize;

    inputs.forEach(input => {
        input.style.border = isValid ? '' : '2px solid red';
    });

    if (!hasCompositionInput) {
        message.textContent = '';
        message.classList.remove('field-helper-error');
    } else if (isValid) {
        message.textContent = `Composition total: ${compositionTotal} of ${groupSize} travelers.`;
        message.classList.remove('field-helper-error');
    } else {
        message.textContent = `Composition total is ${compositionTotal}, which exceeds the group size of ${groupSize}.`;
        message.classList.add('field-helper-error');
    }

    return isValid;
}

function updateRepeatVisitReasonVisibility() {
    const repeatVisitReasonLabel = document.getElementById('repeatVisitReasonLabel');
    const repeatVisitReason = document.getElementById('repeatVisitReason');
    const previousTransportExperience = document.getElementById('previousTransportExperience');
    if (!repeatVisitReasonLabel || !repeatVisitReason) return;

    const visitHistoryNames = ['kedarnath', 'badrinath', 'gangotri', 'yamunotri', 'hemkund'];
    const hasPreviousVisit = visitHistoryNames.some(name => {
        const selected = document.querySelector(`input[name="${name}"]:checked`);
        return selected && selected.value !== '0';
    });

    repeatVisitReasonLabel.style.display = hasPreviousVisit ? 'block' : 'none';
    repeatVisitReason.required = hasPreviousVisit;
    if (previousTransportExperience) previousTransportExperience.style.display = hasPreviousVisit ? 'block' : 'none';

    if (!hasPreviousVisit) {
        repeatVisitReason.value = '';
        repeatVisitReason.style.border = '';
        previousTransportExperience?.querySelectorAll('input[name="priorModeExp"]').forEach(input => {
            input.checked = false;
            input.disabled = true;
        });
    } else {
        previousTransportExperience?.querySelectorAll('input[name="priorModeExp"]').forEach(input => {
            input.disabled = false;
        });
    }
}

function handleStartPointChange() {
    const startPoint = document.querySelector('input[name="startPoint"]:checked');
    const otherStartPointLabel = document.getElementById('otherStartPointLabel');
    const otherStartPointInput = document.getElementById('otherStartPoint');
    const isOther = startPoint && startPoint.value === 'Other';

    if (!otherStartPointLabel || !otherStartPointInput) return;

    otherStartPointLabel.style.display = isOther ? 'block' : 'none';
    otherStartPointInput.required = isOther;
    if (!isOther) {
        otherStartPointInput.value = '';
        otherStartPointInput.style.border = '';
    }
    updateMainHaulHeadings();
    updatePrimaryModeRouteCells();
    updateRestLocationTable();
}

function getSelectedStartPointLabel() {
    const startPoint = document.querySelector('input[name="startPoint"]:checked');
    const otherStartPointInput = document.getElementById('otherStartPoint');

    if (!startPoint || !startPoint.value) return 'Starting Point';
    if (startPoint.value === 'Other') {
        return otherStartPointInput?.value.trim() || 'Other Starting Point';
    }
    return startPoint.value;
}

function updateMainHaulHeadings() {
    const startPointLabel = getSelectedStartPointLabel();
    const mainHaulSectionHeading = document.querySelector('#page-3-C .section-card > h3');
    const destinationsByDham = {
        Kedarnath: 'Sonprayag',
        Badrinath: 'Badrinath',
        Yamunotri: 'Janki Chatti',
        Gangotri: 'Gangotri',
        HemkundSahib: 'Govindghat'
    };

    if (mainHaulSectionHeading) {
        mainHaulSectionHeading.textContent = `Section B1: Main-Haul Choice (${startPointLabel} → Base Camp / Shrine Destination)`;
    }

    Object.entries(destinationsByDham).forEach(([dhamSlug, destination]) => {
        const heading = document.querySelector(`#main-haul-${dhamSlug}-block h4`);
        if (!heading) return;

        const dhamName = dhamSlug === 'HemkundSahib' ? 'Hemkund Sahib' : dhamSlug;
        heading.textContent = `${dhamName}: ${startPointLabel} → ${destination}`;
    });
    updatePrimaryModeRouteCells();
}

function sanitizeFieldId(value) {
    return String(value || 'field').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function controlHasOtherOption(control) {
    if (control.tagName === 'SELECT') {
        return Array.from(control.options).some(option => option.value === 'Other' || option.textContent.trim() === 'Other');
    }

    return control.type === 'checkbox' && control.value === 'Other';
}

function getOtherSpecifyElements(control) {
    const configuredLabelId = control.dataset.otherLabelId;
    const configuredInputId = control.dataset.otherInputId;

    if (configuredLabelId && configuredInputId) {
        return {
            label: document.getElementById(configuredLabelId),
            input: document.getElementById(configuredInputId)
        };
    }

    const fieldId = `otherSpecify_${sanitizeFieldId(control.name || control.id)}`;
    let label = document.getElementById(`${fieldId}Label`);
    let input = document.getElementById(fieldId);

    if (!label || !input) {
        label = document.createElement('label');
        label.id = `${fieldId}Label`;
        label.className = 'other-specify-label';
        label.style.display = 'none';
        label.innerHTML = `Please specify:
          <input type="text" name="${sanitizeFieldId(control.name || control.id)}_otherSpecify" id="${fieldId}" placeholder="Please specify">
        `;
        input = label.querySelector('input');

        const anchor = control.closest('label') || control;
        anchor.insertAdjacentElement('afterend', label);
    }

    return { label, input };
}

function updateOtherSpecifyField(control) {
    if (!controlHasOtherOption(control)) return;

    const { label, input } = getOtherSpecifyElements(control);
    if (!label || !input) return;

    const isOtherSelected = control.tagName === 'SELECT'
        ? control.value === 'Other'
        : control.checked;

    label.style.display = isOtherSelected ? 'block' : 'none';
    input.required = isOtherSelected;

    if (!isOtherSelected) {
        input.value = '';
        input.style.border = '';
    }
}

function initializeOtherSpecifyFields(scope = document) {
    scope.querySelectorAll('select, input[type="checkbox"]').forEach(control => {
        if (controlHasOtherOption(control)) {
            updateOtherSpecifyField(control);
        }
    });
}

function lockEnglishOptionValues(scope = document) {
    scope.querySelectorAll('select option').forEach(option => {
        const hasExplicitValue = option.hasAttribute('value');
        const displayText = option.textContent.trim();

        if (!displayText || option.disabled) return;

        if (!option.dataset.englishValue) {
            option.dataset.englishValue = hasExplicitValue && option.value !== '' ? option.value : displayText;
        }

        if (!hasExplicitValue || option.value !== '') {
            option.value = option.dataset.englishValue;
        }
    });
}

function resetDynamicSurveyState() {
    primaryModeRowIndex = 0;
    restLocationRowIndex = 0;

    if (primaryModeTableBody) primaryModeTableBody.innerHTML = '';
    if (lastMileTableBody) lastMileTableBody.innerHTML = '';
    if (stayDurationTableBody) stayDurationTableBody.innerHTML = '';
    if (restLocationTableBody) restLocationTableBody.innerHTML = '';
    const lastMileReturnSection = document.getElementById('lastMileReturnSection');
    if (lastMileReturnSection) lastMileReturnSection.innerHTML = '';
    const returnModeTableBody = document.querySelector('#returnModeTable tbody');
    if (returnModeTableBody) returnModeTableBody.innerHTML = '';
    const returnJourneyDetails = document.getElementById('returnJourneyDetails');
    if (returnJourneyDetails) returnJourneyDetails.style.display = 'none';

    const transferDetails = document.getElementById('mainHaulTransferDetails');
    const transferDetailsBody = document.querySelector('#mainHaulTransferDetailsTable tbody');
    if (transferDetailsBody) transferDetailsBody.innerHTML = '';
    if (transferDetails) transferDetails.style.display = 'none';

    const sequenceContainer = document.getElementById('dhamSequenceSelection');
    if (sequenceContainer) {
        sequenceContainer.innerHTML = '<h4>Order of Shrine Visits</h4><p style="color: grey;">Select Shrines in A2 to show visit-order fields.</p>';
    }

    document.querySelectorAll('[id^="main-haul-"][id$="-tasks"], [id^="last-mile-"][id$="-tasks"]').forEach(container => {
        container.innerHTML = '';
    });
    document.querySelectorAll('[id^="main-haul-"][id$="-block"], [id^="last-mile-"][id$="-block"]').forEach(block => {
        block.style.display = 'none';
    });

    if (primaryModeTableBody) updatePrimaryModeTable();
    if (restLocationTableBody) updateRestLocationTable();
    updateRepeatVisitReasonVisibility();
}

function clearValidationStyles() {
    form.querySelectorAll('input, select, textarea, table, div.dham-block, .answer-question').forEach(el => {
        el.style.border = '';
    });
}

function startNewResponse() {
    clearSurveyDraft();
    form.reset();
    resetFatigueTracking();
    resetDynamicSurveyState();
    clearValidationStyles();

    sessionStorage.removeItem('charDhamChoiceBlock');
    sessionStorage.removeItem('charDhamChoiceTaskNumbers');
    sessionStorage.removeItem('charDhamChoiceTaskMap');
    selectedChoiceTaskNumbersBySet = {};
    assignChoiceBlock();
    initializeSurveyTiming();

    currentTab = 0;
    showTab(currentTab);
    handleTravelTypeChange();
    renderTable();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function enhanceRatingTables() {
    document.querySelectorAll('.satisfaction-table, .likert-scale').forEach((table, tableIndex) => {
        // Reference visible text so accessible names also follow translated labels.
        const headers = Array.from(table.rows[0].cells);
        headers.forEach((header, columnIndex) => {
            if (!header.id) header.id = `rating-${tableIndex}-column-${columnIndex}`;
        });
        Array.from(table.rows).slice(1).forEach((row, rowIndex) => {
            const statement = row.cells[0];
            if (!statement) return;
            if (!statement.id) statement.id = `rating-${tableIndex}-statement-${rowIndex}`;
            row.querySelectorAll('input[type="radio"]').forEach(radio => {
                const header = headers[radio.closest('td').cellIndex];
                if (header) radio.setAttribute('aria-labelledby', `${statement.id} ${header.id}`);
            });
        });
        if (table.style.display === 'none') return;

        table.addEventListener('click', event => {
            const cell = event.target.closest('td');
            if (!cell) return;
            const radio = cell.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
        });
    });
}

function updateSatisfactionSlider(slider) {
    document.getElementById('satisfactionVal').textContent = slider.value;
    const pct = ((+slider.value - +slider.min) / (+slider.max - +slider.min)) * 100;
    slider.style.setProperty('--slider-fill', pct + '%');
}

// --- Data Handling & Submission ---
function toIndiaTimestamp(date = new Date()) {
    const indiaOffsetMinutes = 330;
    const indiaTime = new Date(date.getTime() + indiaOffsetMinutes * 60 * 1000);
    const localIsoWithoutZone = indiaTime.toISOString().replace('Z', '');
    return `${localIsoWithoutZone}+05:30`;
}

function initializeSurveyTiming() {
    const now = new Date();
    if (surveyStartTimestampInput) {
        surveyStartTimestampInput.value = toIndiaTimestamp(now);
    }
    if (surveySubmitTimestampInput) {
        surveySubmitTimestampInput.value = '';
    }
    if (surveyCompletionSecondsInput) {
        surveyCompletionSecondsInput.value = '';
    }
}

function updateSurveyTimingForSubmit() {
    const submitTime = new Date();
    if (!surveyStartTimestampInput?.value) {
        initializeSurveyTiming();
    }

    if (surveySubmitTimestampInput) {
        surveySubmitTimestampInput.value = toIndiaTimestamp(submitTime);
    }

    if (surveyCompletionSecondsInput && surveyStartTimestampInput?.value) {
        const startTime = new Date(surveyStartTimestampInput.value);
        const elapsedSeconds = Math.max(0, Math.round((submitTime.getTime() - startTime.getTime()) / 1000));
        surveyCompletionSecondsInput.value = String(elapsedSeconds);
    }
}

// ===== FATIGUE TRACKING SYSTEM =====
const fatigueData = { pageTimings: {}, backNavigations: 0, dceTaskTimings: [] };
let _pageEnterTime = null;
let _pageEnterId = null;

function resetFatigueTracking() {
    fatigueData.pageTimings = {};
    fatigueData.backNavigations = 0;
    fatigueData.dceTaskTimings = [];
    _pageEnterTime = null;
    _pageEnterId = null;
    document.querySelectorAll('.dce-task').forEach(task => {
        delete task.dataset.taskStart;
        delete task.dataset.taskElapsedMs;
    });
    const field = document.getElementById('_fatigueMetrics');
    if (field) field.value = '';
}

function recordPageEnter(pageId) {
    if (!pageId || pageId === 'page-7-thankyou') return;
    if (_pageEnterId === pageId && _pageEnterTime !== null) return;
    _pageEnterId = pageId;
    _pageEnterTime = Date.now();
    // All cards on this page become available together. Exclude time on other pages.
    document.getElementById(pageId)?.querySelectorAll('.dce-task').forEach(task => {
        task.dataset.taskStart = String(_pageEnterTime);
    });
}

function recordPageExit(pageId) {
    if (_pageEnterTime !== null && pageId === _pageEnterId) {
        const secs = Math.round((Date.now() - _pageEnterTime) / 1000);
        fatigueData.pageTimings[pageId] = (fatigueData.pageTimings[pageId] || 0) + secs;
        document.getElementById(pageId)?.querySelectorAll('.dce-task').forEach(task => {
            if (task.dataset.taskStart !== undefined) {
                task.dataset.taskElapsedMs = String(Number(task.dataset.taskElapsedMs || 0)
                    + Date.now() - Number(task.dataset.taskStart));
                delete task.dataset.taskStart;
            }
        });
        _pageEnterTime = null;
        _pageEnterId = null;
    }
}

function recordDceTaskTime(radioInput) {
    const taskEl = radioInput.closest('.dce-task');
    if (taskEl && taskEl.dataset.taskStart !== undefined) {
        const secs = Math.round((Number(taskEl.dataset.taskElapsedMs || 0)
            + Date.now() - Number(taskEl.dataset.taskStart)) / 1000);
        fatigueData.dceTaskTimings.push({ task: radioInput.name, seconds: secs });
        taskEl.dataset.taskElapsedMs = '0';
        taskEl.dataset.taskStart = String(Date.now());
    }
}

function computeStraightlineScore() {
    const names = new Set();
    const vals = [];
    document.querySelectorAll('input[type="radio"]:checked').forEach(inp => {
        const n = inp.name;
        if ((n.startsWith('priority') || n.startsWith('attitude') || n.startsWith('rel') ||
             n.startsWith('ropeway') || n.startsWith('rail') || n.startsWith('env') ||
             n.startsWith('eval') || n.startsWith('lastMileEval')) && !names.has(n)) {
            names.add(n);
            vals.push(inp.value);
        }
    });
    if (vals.length < 5) return null;
    const freq = {};
    vals.forEach(v => freq[v] = (freq[v] || 0) + 1);
    return Math.round(Math.max(...Object.values(freq)) / vals.length * 100);
}

function injectFatigueFields() {
    const totalSecs = Object.values(fatigueData.pageTimings).reduce((a, b) => a + b, 0);
    const payload = {
        pageTimings: fatigueData.pageTimings,
        backNavigations: fatigueData.backNavigations,
        dceTaskTimings: fatigueData.dceTaskTimings,
        straightlineScore: computeStraightlineScore(),
        totalSurveySeconds: totalSecs,
        fastResponseFlag: totalSecs < 180,
    };
    let field = document.getElementById('_fatigueMetrics');
    if (!field) {
        field = document.createElement('input');
        field.type = 'hidden'; field.name = 'fatigueMetrics'; field.id = '_fatigueMetrics';
        form.appendChild(field);
    }
    field.value = JSON.stringify(payload);
}
// ===== END FATIGUE TRACKING =====

function getInterDhamTransferCardsHTML(pairKey, transferValue, getValue = () => '') {
    const count = /^\d+$/.test(transferValue) ? Math.min(Number(transferValue), 3) : 0;
    if (!count) return '';
    const [fromSlug, toSlug] = pairKey.split('__');
    const knownDhams = ['Yamunotri', 'Gangotri', 'Kedarnath', 'Badrinath', 'Hemkund Sahib'];
    const fromDham = knownDhams.find(dham => getDhamSlug(dham) === fromSlug) || '';
    const toDham = knownDhams.find(dham => getDhamSlug(dham) === toSlug) || '';
    const locationSuggestions = getTransferLocationSuggestions(fromDham, toDham);

    return Array.from({ length: count }, (_, offset) => {
        const number = offset + 1;
        const suffix = `${pairKey}_${number}`;
        const locationName = `interDhamTransferLocation_${suffix}`;
        const modeName = `interDhamTransferMode_${suffix}`;
        const timeName = `interDhamTransferTime_${suffix}`;
        const costName = `interDhamTransferCost_${suffix}`;
        const fareBasisName = `interDhamTransferFareBasis_${suffix}`;
        const occupancyName = `interDhamTransferOccupancy_${suffix}`;
        const locationListId = `interDhamTransferLocations_${suffix}`;
        const modeValue = getValue(modeName);
        return `<tr class="inter-dham-transfer-row" data-inter-transfer-pair="${escapeAttribute(pairKey)}"><td class="inter-dham-transfer-card" data-label="Intermediate Transfer">
            <div class="inter-dham-transfer-heading"><span>🔄 Intermediate transfer ${number}</span><small class="inter-dham-transfer-route-note">Part of this inter-shrine route</small></div>
            <label>Intermediate transfer location${getTransferLocationInputHTML(locationName, getValue(locationName), locationListId, locationSuggestions)}</label>
            <label>Mode after transfer${getRoadTravelModeButtonsHTML(modeName, modeValue)}</label>
            <label>Time after transfer${getCompactChoiceButtonsHTML(timeName, getIntermediateTimeChoices(), getValue(timeName))}</label>
            <label>Fare after transfer${getCompactChoiceButtonsHTML(costName, getIntermediateCostChoices(), getValue(costName))}</label>
            <label>Fare entered as<select name="${fareBasisName}" required>${getFareBasisOptionsHTML(getValue(fareBasisName))}</select></label>
            <label>Vehicle occupancy<div data-occupancy-for="${occupancyName}">${getCompactChoiceButtonsHTML(occupancyName, getVehicleOccupancyChoices(modeValue), getValue(occupancyName))}</div></label>
        </td></tr>`;
    }).join('');
}

function updateInterDhamRouteLabel(pairKey) {
    const mainRow = document.querySelector(`#interDhamTable tbody tr[data-inter-pair="${pairKey}"]`);
    if (!mainRow) return;
    const from = mainRow.querySelector(`input[name="interDhamFrom_${pairKey}"]`)?.value || '';
    const to = mainRow.querySelector(`input[name="interDhamTo_${pairKey}"]`)?.value || '';
    const transfers = Array.from(document.querySelectorAll(`#interDhamTable tbody tr[data-inter-transfer-pair="${pairKey}"] input[name^="interDhamTransferLocation_"]`))
        .map(input => input.value.trim())
        .filter(Boolean);
    const routeValue = [from, ...transfers, to].filter(Boolean).join(' → ');
    const label = mainRow.querySelector('.inter-dham-route-label');
    const hidden = mainRow.querySelector(`input[name="interDhamRoute_${pairKey}"]`);
    if (label) label.textContent = routeValue;
    if (hidden) hidden.value = routeValue;
    document.querySelectorAll(`#interDhamTable tbody tr[data-inter-transfer-pair="${pairKey}"] .inter-dham-transfer-route-note`).forEach(note => {
        note.textContent = `Part of ${routeValue}`;
    });
}

function updateInterDhamTable() {
    const section = document.getElementById('interDhamSection');
    const tbody = document.getElementById('interDhamTableBody');
    const hint = document.getElementById('interDhamHint');
    if (!section || !tbody) return;

    const continuity = document.querySelector('input[name="onwardVehicleContinuity"]:checked')?.value || '';
    if (continuity !== 'Changed vehicle or mode') {
        section.style.display = 'none';
        section.querySelectorAll('input, select').forEach(control => { control.disabled = true; });
        return;
    }

    section.querySelectorAll('input, select').forEach(control => { control.disabled = false; });

    // Collect selected shrines in sequence order from the sequence dropdowns
    const seqSelects = document.querySelectorAll('#dhamSequenceSelection select');
    const orderedDhams = [];
    // Build a map: sequence number -> dham name from the select values
    const seqMap = {};
    seqSelects.forEach(sel => {
        const val = sel.value;
        const num = parseInt(sel.name && sel.name.match(/(\d+)/) ? sel.name.match(/(\d+)/)[1] : '0', 10);
        if (val && val !== '' && !isNaN(num)) seqMap[num] = val;
    });
    // Sort by sequence number
    Object.keys(seqMap).sort((a,b) => a-b).forEach(k => orderedDhams.push(seqMap[k]));

    // If < 2 Shrines in sequence, hide section
    if (orderedDhams.length < 2) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    // Generate pairs
    const pairs = [];
    const helicopterPackageDhams = getMainHaulHelicopterDhams();
    for (let i = 0; i < orderedDhams.length - 1; i++) {
        if (helicopterPackageDhams.has(orderedDhams[i]) && helicopterPackageDhams.has(orderedDhams[i + 1])) continue;
        pairs.push({ from: orderedDhams[i], to: orderedDhams[i+1] });
    }

    const previousValues = {};
    tbody.querySelectorAll('input:not([type="radio"]), input[type="radio"]:checked, select').forEach(control => {
        previousValues[control.name] = control.value;
    });

    // Keep existing rows that match existing pairs, add new, remove stale
    const existingRows = {};
    tbody.querySelectorAll('tr[data-inter-pair]').forEach(row => {
        existingRows[row.dataset.interPair] = row;
    });

    // Clear and rebuild
    tbody.innerHTML = '';

    pairs.forEach(pair => {
        const pairKey = `${pair.from.replace(/\s/g,'')}__${pair.to.replace(/\s/g,'')}`;
        const modeVal = previousValues[`interDhamMode_${pairKey}`] || '';
        const timeVal = previousValues[`interDhamTime_${pairKey}`] || '';
        const costVal = previousValues[`interDhamCost_${pairKey}`] || '';
        const occupancyVal = previousValues[`interDhamOccupancy_${pairKey}`] || '';
        const fareBasisVal = previousValues[`interDhamFareBasis_${pairKey}`] || '';
        const transferVal = previousValues[`interDhamTransferCount_${pairKey}`] || '';
        const getExistingValue = name => previousValues[name] || '';
        const fromBase = getMainHaulBaseDestination(pair.from);
        const toBase = getMainHaulBaseDestination(pair.to);
        const routeValue = `${fromBase} → ${toBase}`;

        const toDhamInfo = DHAM_ROUTE_INFO[pair.to] || {};
        const toDhamColor = toDhamInfo.color || '';
        const tr = document.createElement('tr');
        tr.dataset.interPair = pairKey;
        if (toDhamColor) tr.style.cssText = `--dham-clr:${toDhamColor}`;
        const toDhamIcon = toDhamInfo.icon || '🗺️';
        tr.innerHTML = `
            <td class="journey-card-title" data-label=""><span class="primary-dham-label"><span class="primary-dham-icon" aria-hidden="true">${toDhamIcon}</span>${escapeHTML(pair.from)} → ${escapeHTML(pair.to)}</span></td>
            <td class="journey-card-route" data-label="Route"><span class="inter-dham-route-label">${escapeHTML(routeValue)}</span>
                <input type="hidden" name="interDhamFrom_${pairKey}" value="${escapeAttribute(fromBase)}">
                <input type="hidden" name="interDhamTo_${pairKey}" value="${escapeAttribute(toBase)}">
                <input type="hidden" name="interDhamRoute_${pairKey}" value="${escapeAttribute(routeValue)}">
                <button type="button" class="copy-leg-settings" onclick="copyPreviousLegSettings(this)">Use previous leg's mode &amp; fare type</button>
            </td>
            <td data-label="Vehicle Changes Within This Leg">
              <select name="interDhamTransferCount_${pairKey}" required>${getMainHaulTransferOptionsHTML(transferVal)}</select>
            </td>
            <td data-label="Mode Used at Start of Leg">${getRoadTravelModeButtonsHTML(`interDhamMode_${pairKey}`, modeVal)}</td>
            <td data-label="One-Way Time">${getCompactChoiceButtonsHTML(`interDhamTime_${pairKey}`, getInterDhamTimeChoices(), timeVal)}</td>
            <td data-label="One-Way Fare">${getCompactChoiceButtonsHTML(`interDhamCost_${pairKey}`, getTravelCostChoices(), costVal)}</td>
            <td data-label="Fare Entered As"><select name="interDhamFareBasis_${pairKey}" required>${getFareBasisOptionsHTML(fareBasisVal)}</select></td>
            <td data-label="Vehicle Occupancy" data-occupancy-for="interDhamOccupancy_${pairKey}">${getCompactChoiceButtonsHTML(`interDhamOccupancy_${pairKey}`, getVehicleOccupancyChoices(modeVal), occupancyVal)}</td>
            `;
        tbody.appendChild(tr);
        lockEnglishOptionValues(tr);
        tbody.insertAdjacentHTML('beforeend', getInterDhamTransferCardsHTML(pairKey, transferVal, getExistingValue));
        tbody.querySelectorAll(`tr[data-inter-transfer-pair="${pairKey}"]`).forEach(transferRow => lockEnglishOptionValues(transferRow));
        updateInterDhamRouteLabel(pairKey);
    });

    if (hint) hint.textContent = `${pairs.length} onward segment${pairs.length>1?'s':''} shown after your first shrine, based on your selected visit order.`;
}

function copyPreviousLegSettings(button) {
    const currentRow = button.closest('tr');
    if (!currentRow) return;

    const mainRows = Array.from(document.querySelectorAll('#interDhamTable tbody tr[data-inter-pair]'));
    const currentIndex = mainRows.indexOf(currentRow);
    const previousRow = currentIndex > 0 ? mainRows[currentIndex - 1] : null;
    const sourceMode = previousRow
        ? previousRow.querySelector('input[name^="interDhamMode_"]:checked')
        : document.querySelector('#primaryModeTable input[name^="primaryMode_"]:checked');
    const sourceFareBasis = previousRow
        ? previousRow.querySelector('select[name^="interDhamFareBasis_"]')
        : document.querySelector('#primaryModeTable select[name^="primaryFareBasis_"]');
    const targetMode = sourceMode?.value
        ? currentRow.querySelector(`input[name^="interDhamMode_"][value="${CSS.escape(sourceMode.value)}"]`)
        : null;
    const targetFareBasis = currentRow.querySelector('select[name^="interDhamFareBasis_"]');

    if (targetMode) targetMode.checked = true;
    if (sourceFareBasis?.value && targetFareBasis) targetFareBasis.value = sourceFareBasis.value;
    renderJourneyPreviews();
}

function handleFormSubmit() {
    updateChoiceBlockInput();
    updateSurveyTimingForSubmit();
    injectFatigueFields();
    lockEnglishOptionValues(form);

    // --- Build localStorage snapshot (preserves arrays for multi-checkboxes) ---
    const formData = new FormData(form);
    const data = {};
    for (const [key, value] of formData.entries()) {
      if (data.hasOwnProperty(key)) {
        if (Array.isArray(data[key])) {
          data[key].push(value);
        } else {
          data[key] = [data[key], value];
        }
      } else {
        data[key] = value;
      }
    }
    const existingData = localStorage.getItem("charDhamSurvey");
    responses = existingData ? JSON.parse(existingData) : [];
    responses.push(data);
    localStorage.setItem("charDhamSurvey", JSON.stringify(responses));
    console.log('Data saved to localStorage (Backup)');

    // --- Consolidate multi-value checkbox groups for Google Sheet POST ---
    // Google Apps Script e.parameter (singular) only captures the last value for repeated keys.
    // For each checkbox group with multiple checked values, inject a single hidden field
    // with all selected values joined by "; " and disable the individual checkboxes temporarily.
    const consolidatedFields = [];
    const checkboxGroups = {};
    form.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)').forEach(cb => {
        if (!checkboxGroups[cb.name]) checkboxGroups[cb.name] = [];
        checkboxGroups[cb.name].push(cb.value);
    });
    Object.entries(checkboxGroups).forEach(([name, values]) => {
        if (values.length > 1) {
            // Disable all individual checkboxes for this name so they don't POST
            form.querySelectorAll(`input[type="checkbox"][name="${name}"]`).forEach(cb => { cb.disabled = true; });
            // Inject a single hidden field with joined values
            const hidden = document.createElement('input');
            hidden.type = 'hidden';
            hidden.name = name;
            hidden.value = values.join('; ');
            form.appendChild(hidden);
            consolidatedFields.push({ name, hidden, checkboxes: form.querySelectorAll(`input[type="checkbox"][name="${name}"]`) });
        }
    });

    // Submit to Google Apps Script via hidden iframe
    // URL split to avoid plain-text indexing in GitHub search
    const _s = ["https://script.google.com/macros/s/",
                 "AKfycbymEqiCZku9UAHMYF7cvbNS6KDCyZ5ad3OjoTAgRN_2LiaQ7fXTQuMbIlu6z1gH4AIL",
                 "/exec"].join("");
    const scriptUrl = _s;
    form.action = scriptUrl;
    form.target = "googleSheetTarget";
    form.method = "POST";
    form.submit();
    console.log('Data submitted to Google Apps Script.');

    // Restore checkbox state and remove temporary hidden fields
    consolidatedFields.forEach(({ hidden, checkboxes }) => {
        hidden.remove();
        checkboxes.forEach(cb => { cb.disabled = false; });
    });

    // Reset form attributes
    form.removeAttribute("action");
    form.removeAttribute("target");
    form.removeAttribute("method");

    renderTable(); 
    clearSurveyDraft();
}

// --- Local Storage Table & Export Functions ---
function renderTable() {
    if (!tableBody) return;
    tableBody.innerHTML = "";
    responses = JSON.parse(localStorage.getItem("charDhamSurvey")) || [];
    responses.forEach((res, index) => {
        const row = tableBody.insertRow();
        row.insertCell(0).innerHTML = `<input type="checkbox" class="local-response-checkbox" data-index="${index}" aria-label="Select response ${index + 1}">`;
        row.insertCell(1).textContent = res.age || 'N/A';
        row.insertCell(2).textContent = res.gender || 'N/A';
        row.insertCell(3).textContent = res.originCityDistrict || 'N/A';
        row.insertCell(4).textContent = res.occupation || 'N/A';
        row.insertCell(5).textContent = res.income || 'N/A';
        row.insertCell(6).textContent = res.education || 'N/A';
        row.insertCell(7).innerHTML = `<button class="delete-btn" onclick="deleteResponse(${index})">Delete</button>`;
    });
}

function deleteResponse(index) {
    if (confirm("Are you sure you want to delete this response?")) {
        responses.splice(index, 1);
        localStorage.setItem("charDhamSurvey", JSON.stringify(responses));
        renderTable();
    }
}

function selectAllLocalResponses() {
    const checkboxes = document.querySelectorAll('.local-response-checkbox');
    const shouldSelect = Array.from(checkboxes).some(checkbox => !checkbox.checked);
    checkboxes.forEach(checkbox => {
        checkbox.checked = shouldSelect;
    });
}

function deleteSelectedLocalResponses() {
    const selectedIndexes = Array.from(document.querySelectorAll('.local-response-checkbox:checked'))
        .map(checkbox => Number(checkbox.dataset.index))
        .filter(Number.isInteger);

    if (selectedIndexes.length === 0) {
        alert("Please select at least one local response to delete.");
        return;
    }

    if (!confirm(`Delete ${selectedIndexes.length} selected local response(s)? This will not delete Google Sheet rows.`)) {
        return;
    }

    const selectedIndexSet = new Set(selectedIndexes);
    responses = (JSON.parse(localStorage.getItem("charDhamSurvey")) || [])
        .filter((_, index) => !selectedIndexSet.has(index));
    localStorage.setItem("charDhamSurvey", JSON.stringify(responses));
    renderTable();
}

function deleteAllLocalResponses() {
    const savedResponses = JSON.parse(localStorage.getItem("charDhamSurvey")) || [];
    if (savedResponses.length === 0) {
        alert("No local responses found to delete.");
        return;
    }

    if (!confirm(`Delete all ${savedResponses.length} local response(s)? This will not delete Google Sheet rows.`)) {
        return;
    }

    responses = [];
    localStorage.removeItem("charDhamSurvey");
    renderTable();
}

function exportToCSV() {
    try {
        const savedResponses = localStorage.getItem("charDhamSurvey");
        const responsesToExport = savedResponses ? JSON.parse(savedResponses) : [];

        if (responsesToExport.length === 0) {
            alert("No survey responses found to export.");
            return;
        }

        const allKeys = new Set();
        responsesToExport.forEach(r => Object.keys(r).forEach(key => allKeys.add(key)));
        const headers = Array.from(allKeys);
        let csv = headers.join(',') + '\n';

        responsesToExport.forEach(r => {
            const row = headers.map(header => {
                let cell = r[header];
                if (cell === undefined || cell === null) return '""';
                if (Array.isArray(cell)) cell = cell.join('; '); 
                const cellString = String(cell).replace(/"/g, '""');
                return `"${cellString}"`;
            });
            csv += row.join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "char_dham_survey_responses.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (e) {
        console.error("CSV Export failed: ", e);
        alert("An error occurred during CSV export.");
    }
}

function exportToXLSX() {
    const savedResponses = localStorage.getItem("charDhamSurvey");
    const responsesToExport = savedResponses ? JSON.parse(savedResponses) : [];
    
    if (responsesToExport.length === 0) {
        alert("No survey responses found to export.");
        return;
    }
    if (typeof XLSX === 'undefined') {
        alert("Excel export library is not loaded. Please check your internet connection and the <script> tag in index.html.");
        return;
    }

    const workbook = XLSX.utils.book_new();
    appendRawOrderedSheet(workbook, responsesToExport);
    appendJsonSheet(workbook, "Respondents", buildLocalRespondents(responsesToExport));
    appendJsonSheet(workbook, "DhamVisits", buildLocalDhamVisits(responsesToExport));
    appendJsonSheet(workbook, "MainHaulSegments", buildLocalMainHaulSegments(responsesToExport));
    appendJsonSheet(workbook, "Stopovers", buildLocalStopovers(responsesToExport));
    appendJsonSheet(workbook, "LastMileTrips", buildLocalLastMileTrips(responsesToExport));
    appendJsonSheet(workbook, "ChoiceResponses", buildLocalChoiceResponses(responsesToExport));
    XLSX.writeFile(workbook, "char_dham_survey_responses.xlsx");
}

function localCellValue(value) {
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object' && value !== null) return JSON.stringify(value);
    return value ?? '';
}

function getLocalResponseId(response, index) {
    return response.responseId || response.localResponseId || `LOCAL_${String(index + 1).padStart(4, '0')}`;
}

function getLocalField(response, key) {
    return localCellValue(response[key]);
}

function getLocalSelectedDhams(response) {
    const value = response.dhamCurrentVisit;
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        return value.split(',').map(item => item.trim()).filter(Boolean);
    }
    return [];
}

function localDhamSlug(dham) {
    return String(dham).replace(/\s/g, '');
}

function localPreviousVisitKey(dham) {
    return dham === 'Hemkund Sahib' ? 'hemkund' : String(dham).toLowerCase();
}

function appendJsonSheet(workbook, sheetName, rows) {
    const worksheet = rows.length > 0
        ? XLSX.utils.json_to_sheet(rows)
        : XLSX.utils.aoa_to_sheet([['No data']]);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
}

function appendRawOrderedSheet(workbook, responsesToExport) {
    const groups = getLocalRawColumnGroups(responsesToExport);
    const headers = [];
    const sections = [];

    groups.forEach(group => {
        group.fields.forEach(field => {
            if (!headers.includes(field)) {
                headers.push(field);
                sections.push(group.section);
            }
        });
    });

    const rows = [
        sections,
        headers,
        ...responsesToExport.map((response, index) => headers.map(header => {
            if (header === 'responseId') return getLocalResponseId(response, index);
            return getLocalField(response, header);
        }))
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!merges'] = buildSectionMerges(sections);
    XLSX.utils.book_append_sheet(workbook, worksheet, "RawOrdered");
}

function buildSectionMerges(sections) {
    const merges = [];
    let start = 0;

    for (let i = 1; i <= sections.length; i++) {
        if (sections[i] !== sections[start]) {
            if (i - start > 1) {
                merges.push({ s: { r: 0, c: start }, e: { r: 0, c: i - 1 } });
            }
            start = i;
        }
    }

    return merges;
}

function getLocalRawColumnGroups(responsesToExport) {
    const allKeys = Array.from(new Set(responsesToExport.flatMap(response => Object.keys(response))));
    const hasKey = key => allKeys.includes(key);
    const matching = regex => allKeys.filter(key => regex.test(key)).sort(naturalLocalSort);
    const dynamicIndexed = prefixes => {
        const suffixes = new Set();
        prefixes.forEach(prefix => {
            allKeys.forEach(key => {
                const match = key.match(new RegExp(`^${prefix}_(.+)$`));
                if (match) suffixes.add(match[1]);
            });
        });
        return Array.from(suffixes).sort(mainHaulLocalSuffixSort).flatMap(suffix =>
            prefixes.map(prefix => `${prefix}_${suffix}`).filter(hasKey)
        );
    };

    const groups = [
        { section: 'Submission', fields: ['responseId', 'surveyStartTimestamp', 'surveySubmitTimestamp', 'surveyCompletionSeconds', 'choiceBlock', 'deviceId', 'deviceFingerprint', 'geoLat', 'geoLng', 'geoAccuracy', 'geoTimestamp', 'geoStatus', 'fatigueMetrics'] },
        { section: 'Respondent Profile', fields: ['age', 'gender', 'originStateUT', 'originCityDistrict', 'occupation', 'income', 'education'] },
        { section: 'Travel Group', fields: ['tripStatus', 'travelType', 'groupSize', 'groupAdults', 'groupChildren', 'groupElderly', 'groupAssistanceCount'] },
        { section: 'Planning And Budget', fields: ['transportDecisionMaker', 'yatraRegistration', 'transportBudgetBasis', 'transportBudget', 'transportBudgetGroup'] },
        { section: 'Visit History And Itinerary', fields: ['kedarnath', 'badrinath', 'gangotri', 'yamunotri', 'hemkund', 'dhamCurrentVisit', ...matching(/^ongoingDhamStatus_/), 'repeatVisitReason', 'priorModeExp', 'startPoint', 'otherStartPoint', 'totalDurationDays', ...matching(/^dhamSequence_\d+$/)] },
        { section: 'Main-Haul Transfers', fields: ['onwardVehicleContinuity', 'mainHaulTransferCount_Kedarnath', 'mainHaulTransferCount_Badrinath', 'mainHaulTransferCount_Gangotri', 'mainHaulTransferCount_Yamunotri', 'mainHaulTransferCount_HemkundSahib', ...matching(/^mainHaulTransfer(Location|Mode|Time|TimeRange|Cost|CostRange|FareBasis|Occupancy)_/)] },
        { section: 'Main-Haul Travel Rows', fields: dynamicIndexed(['primaryDham', 'primaryRoute', 'primaryMode', 'primaryTime', 'primaryTimeRange', 'primaryCost', 'primaryCostRange', 'primaryFareBasis', 'primaryOccupancy', 'primaryHelicopterScope', 'primaryHelicopterCoveredDhams', 'primaryHelicopterBoardingPoint', 'primaryHelicopterPackageDuration', 'primaryHelicopterFareIncludes', 'primaryHelicopterBookingDifficulty', 'primaryHelicopterWaiting', 'primaryHelicopterDisruption', 'primaryHelicopterWeightCharge']) },
        { section: 'Inter-Shrine Travel', fields: allKeys.filter(key => /^interDham(From|To|Route|Mode|Time|Cost|FareBasis|Occupancy|TransferCount|TransferLocation|TransferMode|TransferTime|TransferCost|TransferFareBasis|TransferOccupancy|TransferLocations|ModesAfterTransfer)_/.test(key)).sort(naturalLocalSort) },
        { section: 'Stopovers', fields: dynamicIndexed(['restRoute', 'restLocation', 'restPurpose', 'restDurationChoice', 'restDuration', 'restAccom', 'restCostChoice', 'restCost']) },
        { section: 'Last-Mile Travel', fields: ['kedarnathAccessType', 'kedarnathHelicopterBoardingPoint', 'kedarnathHelicopterTime', 'kedarnathHelicopterCost', 'kedarnathHelicopterWaitingTime', ...allKeys.filter(key => /^(lastMileApproachDestination|lastMileApproachMountainMode|lastMileApproachMountainTimeBand|lastMileApproachMountainTime|lastMileApproachMountainCostBand|lastMileApproachMountainCost|lastMileApproachStop|lastMileApproachMode|lastMileApproachTimeBand|lastMileApproachTime|lastMileApproachCost|lastMileRoute|lastMileMode|lastMileTimeBand|lastMileTime|lastMileCostBand|lastMileCost|lastMileReturnType|lastMileReturnRoute|lastMileReturnHelipad|lastMileReturnLegRoute|lastMileReturnMode|lastMileReturnTimeBand|lastMileReturnTime|lastMileReturnCostBand|lastMileReturnCost)_/.test(key)).sort(naturalLocalSort)] },
        { section: 'Stay And Accommodation', fields: allKeys.filter(key => /^(stayLocation|stayDuration|stayAccom|stayAccomCost|stayAccomCostRange|stayAccomCostBasis)_/.test(key)).sort(naturalLocalSort) },
        { section: 'Service Evaluation', fields: allKeys.filter(key => /^(eval|lastMileEval)/.test(key)).sort(naturalLocalSort) },
        { section: 'Main-Haul Choice Experiment', fields: ['railwayAwareness', 'hillTrainExperience', 'railwaySentiment', 'railGate', 'railNoReason', 'railNoReasonOtherText', 'railMaxFare', 'railStress', 'railCostConcern', 'railFlexibility', 'railAccessibility', 'railCongestion', ...matching(/^main_haul_[A-Za-z]+_Task\d+$/)] },
        { section: 'Last-Mile Choice Experiment', fields: ['ropewayAwareness', 'ropewayGate', 'ropewayNoReason', 'ropewayNoReasonOtherText', 'ropewayCostPreference', 'ropewaySpiritual', 'ropewaySafety', 'ropewaySubsidy', 'wtpRopewayShrine', 'wtpRopewayKedarnath', 'ropewayDriver', ...matching(/^last_mile_[A-Za-z]+_Task\d+$/)] },
        { section: 'Integrated Services', fields: ['integratedUse', 'integratedPayment', 'guaranteedSeatWtp', 'integratedNoReason', 'integratedTime', 'integratedCost', 'integratedComfort', 'integratedReliability', 'integratedSafety'] },
        { section: 'Priorities And Attitudes', fields: allKeys.filter(key => /^(priority|attitude)|maxAcceptableWait/.test(key)).sort(naturalLocalSort) },
        { section: 'Feedback', fields: ['insuranceMedicalAwareness', 'challenge', 'feedbackChallenge', 'feedbackSuggestions', 'feedbackOther'] },
        { section: 'Lucky Draw', fields: ['luckyDrawUpi'] }
    ].map(group => ({ ...group, fields: group.fields.filter(field => field === 'responseId' || hasKey(field)) }));

    const known = new Set(groups.flatMap(group => group.fields));
    const otherSpecify = allKeys.filter(key => !known.has(key) && key.endsWith('_otherSpecify')).sort(naturalLocalSort);
    const other = allKeys.filter(key => !known.has(key) && !otherSpecify.includes(key)).sort(naturalLocalSort);
    if (otherSpecify.length) groups.push({ section: 'Other Specify', fields: otherSpecify });
    if (other.length) groups.push({ section: 'Other Raw Fields', fields: other });
    return groups;
}

function naturalLocalSort(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function mainHaulLocalSuffixSort(a, b) {
    const parse = suffix => {
        const order = { Kedarnath: 1, Badrinath: 2, Gangotri: 3, Yamunotri: 4, HemkundSahib: 5 };
        const stable = String(suffix).match(/^([A-Za-z]+)_(route|segment(\d+))$/);
        if (stable) return [order[stable[1]] || 98, stable[2] === 'route' ? 0 : Number(stable[3])];
        const numeric = String(suffix).match(/^\d+$/);
        if (numeric) return [99, Number(suffix)];
        return [98, 999];
    };
    const pa = parse(a);
    const pb = parse(b);
    return pa[0] - pb[0] || pa[1] - pb[1] || naturalLocalSort(a, b);
}

function buildLocalRespondents(responsesToExport) {
    const headers = ['responseId', 'surveyStartTimestamp', 'surveySubmitTimestamp', 'surveyCompletionSeconds', 'deviceId', 'geoLat', 'geoLng', 'geoAccuracy', 'geoStatus', 'age', 'gender', 'originStateUT', 'originCityDistrict', 'occupation', 'income', 'education', 'tripStatus', 'travelType', 'groupSize', 'groupAdults', 'groupChildren', 'groupElderly', 'groupAssistanceCount', 'transportInfoSource', 'transportBookingMethod', 'transportDecisionMaker', 'yatraRegistration', 'transportBudget', 'startPoint', 'otherStartPoint', 'totalDurationDays', 'dhamCurrentVisit', 'repeatVisitReason', 'priorModeExp', 'railwayAwareness', 'hillTrainExperience', 'railGate', 'railNoReason', 'railNoReasonOtherText', 'ropewayAwareness', 'ropewayGate', 'ropewayNoReason', 'ropewayNoReasonOtherText', 'integratedUse', 'integratedPayment', 'guaranteedSeatWtp', 'helicopterReducedCostIntent', 'integratedNoReason', 'insuranceMedicalAwareness', 'challenge', 'feedbackChallenge', 'feedbackSuggestions', 'feedbackOther'];
    return responsesToExport.map((response, index) => Object.fromEntries(headers.map(header => [
        header,
        header === 'responseId' ? getLocalResponseId(response, index) : getLocalField(response, header)
    ])));
}

function buildLocalDhamVisits(responsesToExport) {
    return responsesToExport.flatMap((response, index) => {
        const responseId = getLocalResponseId(response, index);
        return getLocalSelectedDhams(response).map(dham => {
            const slug = localDhamSlug(dham);
            return {
                responseId,
                dham,
                previousVisits: getLocalField(response, localPreviousVisitKey(dham)),
                ongoingTripStatus: getLocalField(response, `ongoingDhamStatus_${slug}`),
                mainHaulTransfers: getLocalField(response, `mainHaulTransferCount_${slug}`),
                stayLocation: getLocalField(response, `stayLocation_${slug}`),
                stayDuration: getLocalField(response, `stayDuration_${slug}`),
                stayAccommodation: getLocalField(response, `stayAccom_${slug}`),
                stayAccommodationCost: getLocalField(response, `stayAccomCost_${slug}`),
                stayAccommodationCostRange: getLocalField(response, `stayAccomCostRange_${slug}`),
                stayAccommodationCostBasis: getLocalField(response, `stayAccomCostBasis_${slug}`)
            };
        });
    });
}

function getLocalMainHaulSuffixes(response) {
    return Object.keys(response)
        .map(key => key.match(/^primaryDham_(.+)$/))
        .filter(Boolean)
        .map(match => match[1])
        .sort(mainHaulLocalSuffixSort);
}

function buildLocalMainHaulSegments(responsesToExport) {
    return responsesToExport.flatMap((response, index) => {
        const responseId = getLocalResponseId(response, index);
        return getLocalMainHaulSuffixes(response).map(suffix => ({
            responseId,
            segmentIndex: suffix,
            dham: getLocalField(response, `primaryDham_${suffix}`),
            route: getLocalField(response, `primaryRoute_${suffix}`),
                mode: getLocalField(response, `primaryMode_${suffix}`),
                timeHours: getLocalField(response, `primaryTime_${suffix}`),
                timeRange: getLocalField(response, `primaryTimeRange_${suffix}`),
                costPerPerson: getLocalField(response, `primaryCost_${suffix}`),
                costRange: getLocalField(response, `primaryCostRange_${suffix}`),
            fareEnteredAs: getLocalField(response, `primaryFareBasis_${suffix}`),
            vehicleOccupancy: getLocalField(response, `primaryOccupancy_${suffix}`),
            helicopterScope: getLocalField(response, `primaryHelicopterScope_${suffix}`),
            helicopterCoveredDhams: getLocalField(response, `primaryHelicopterCoveredDhams_${suffix}`),
            helicopterBoardingPoint: getLocalField(response, `primaryHelicopterBoardingPoint_${suffix}`),
            helicopterPackageDurationDays: getLocalField(response, `primaryHelicopterPackageDuration_${suffix}`),
            helicopterFareIncludes: getLocalField(response, `primaryHelicopterFareIncludes_${suffix}`),
            helicopterBookingDifficulty: getLocalField(response, `primaryHelicopterBookingDifficulty_${suffix}`),
            helicopterWaitingMinutes: getLocalField(response, `primaryHelicopterWaiting_${suffix}`),
            helicopterDisruption: getLocalField(response, `primaryHelicopterDisruption_${suffix}`),
            helicopterExtraWeightCharge: getLocalField(response, `primaryHelicopterWeightCharge_${suffix}`)
        }));
    });
}

function buildLocalStopovers(responsesToExport) {
    return responsesToExport.flatMap((response, index) => {
        const responseId = getLocalResponseId(response, index);
        return Object.keys(response)
            .map(key => key.match(/^restRoute_(.+)$/))
            .filter(Boolean)
            .map(match => match[1])
            .sort(naturalLocalSort)
            .map(suffix => ({
                responseId,
                stopIndex: suffix,
                route: getLocalField(response, `restRoute_${suffix}`),
                location: getLocalField(response, `restLocation_${suffix}`),
                purpose: getLocalField(response, `restPurpose_${suffix}`),
                durationHours: getLocalField(response, `restDuration_${suffix}`),
                durationRange: getLocalField(response, `restDurationChoice_${suffix}`),
                facilityType: getLocalField(response, `restAccom_${suffix}`),
                cost: getLocalField(response, `restCost_${suffix}`),
                costRange: getLocalField(response, `restCostChoice_${suffix}`)
            }));
    });
}

function buildLocalLastMileTrips(responsesToExport) {
    return responsesToExport.flatMap((response, index) => {
        const responseId = getLocalResponseId(response, index);
        return getLocalSelectedDhams(response).map(dham => {
            const slug = localDhamSlug(dham);
            return {
                responseId,
                dham,
                approachMode: getLocalField(response, `lastMileApproachMode_${slug}`),
                mountainDestination: getLocalField(response, `lastMileApproachDestination_${slug}`),
                mountainMode: getLocalField(response, `lastMileApproachMountainMode_${slug}`),
                mountainTimeBand: getLocalField(response, `lastMileApproachMountainTimeBand_${slug}`),
                mountainTimeHours: getLocalField(response, `lastMileApproachMountainTime_${slug}`),
                mountainCostBand: getLocalField(response, `lastMileApproachMountainCostBand_${slug}`),
                mountainCost: getLocalField(response, `lastMileApproachMountainCost_${slug}`),
                ghangariaStop: getLocalField(response, `lastMileApproachStop_${slug}`),
                route: getLocalField(response, `lastMileRoute_${slug}`),
                mode: getLocalField(response, `lastMileMode_${slug}`),
                timeHours: getLocalField(response, `lastMileTime_${slug}`),
                timeBand: getLocalField(response, `lastMileTimeBand_${slug}`),
                cost: getLocalField(response, `lastMileCost_${slug}`),
                costBand: getLocalField(response, `lastMileCostBand_${slug}`),
                returnType: getLocalField(response, `lastMileReturnType_${slug}`),
                returnRoute: getLocalField(response, `lastMileReturnRoute_${slug}`),
                returnHelipad: getLocalField(response, `lastMileReturnHelipad_${slug}`),
                returnLeg1Route: getLocalField(response, `lastMileReturnLegRoute_${slug}`),
                returnTimeBand: getLocalField(response, `lastMileReturnTimeBand_${slug}`),
                returnCostBand: getLocalField(response, `lastMileReturnCostBand_${slug}`),
                returnLeg2Route: getLocalField(response, `lastMileReturnLegRoute_${slug}_Leg2`),
                returnLeg2Mode: getLocalField(response, `lastMileReturnMode_${slug}_Leg2`),
                returnLeg2TimeBand: getLocalField(response, `lastMileReturnTimeBand_${slug}_Leg2`),
                returnLeg2TimeHours: getLocalField(response, `lastMileReturnTime_${slug}_Leg2`),
                returnLeg2CostBand: getLocalField(response, `lastMileReturnCostBand_${slug}_Leg2`),
                returnLeg2Cost: getLocalField(response, `lastMileReturnCost_${slug}_Leg2`),
                returnLeg3Route: getLocalField(response, `lastMileReturnLegRoute_${slug}_Leg3`),
                returnLeg3Mode: getLocalField(response, `lastMileReturnMode_${slug}_Leg3`),
                returnLeg3TimeBand: getLocalField(response, `lastMileReturnTimeBand_${slug}_Leg3`),
                returnLeg3TimeHours: getLocalField(response, `lastMileReturnTime_${slug}_Leg3`),
                returnLeg3CostBand: getLocalField(response, `lastMileReturnCostBand_${slug}_Leg3`),
                returnLeg3Cost: getLocalField(response, `lastMileReturnCost_${slug}_Leg3`),
                returnMode: getLocalField(response, `lastMileReturnMode_${slug}`),
                returnTimeHours: getLocalField(response, `lastMileReturnTime_${slug}`),
                returnCost: getLocalField(response, `lastMileReturnCost_${slug}`)
            };
        });
    });
}

function buildLocalChoiceResponses(responsesToExport) {
    return responsesToExport.flatMap((response, index) => {
        const responseId = getLocalResponseId(response, index);
        return Object.keys(response)
            .map(key => {
                const match = key.match(/^(main_haul|last_mile)_([A-Za-z]+)_Task(\d+)$/);
                if (!match) return null;
                const rawChoice = String(getLocalField(response, key));
                const split = rawChoice.split(':');
                return {
                    responseId,
                    experiment: match[1],
                    dham: match[2] === 'HemkundSahib' ? 'Hemkund Sahib' : match[2],
                    task: Number(match[3]),
                    chosenOptionCode: split[0] || '',
                    chosenOptionLabel: split.slice(1).join(':').trim()
                };
            })
            .filter(Boolean);
    });
}


// ===== DEVICE ID & GEOLOCATION =====

function initDeviceId() {
    const KEY = 'charDhamDeviceId';
    let id = localStorage.getItem(KEY);
    if (!id) {
        // RFC-4122 v4 UUID using crypto.randomUUID when available, otherwise manual
        id = typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
        localStorage.setItem(KEY, id);
    }
    const el = document.getElementById('deviceId');
    if (el) el.value = id;
}

function initDeviceFingerprint() {
    const fp = {
        ua: navigator.userAgent,
        platform: navigator.platform || navigator.userAgentData?.platform || '',
        lang: navigator.language,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen: `${screen.width}x${screen.height}@${screen.colorDepth}`,
        pixelRatio: window.devicePixelRatio,
        touchPoints: navigator.maxTouchPoints,
        vendor: navigator.vendor || '',
    };
    const el = document.getElementById('deviceFingerprint');
    if (el) el.value = JSON.stringify(fp);
}

function initGeolocation() {
    const statusBar  = document.getElementById('geoStatusBar');
    const statusIcon = document.getElementById('geoStatusIcon');
    const statusText = document.getElementById('geoStatusText');

    function setStatus(icon, text, bg, border) {
        if (statusIcon) statusIcon.textContent = icon;
        if (statusText) statusText.textContent = text;
        if (statusBar)  { statusBar.style.background = bg; statusBar.style.borderColor = border; }
    }

    function setGeoFields(lat, lng, accuracy, ts, status) {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        set('geoLat',       lat      !== null ? String(lat)      : '');
        set('geoLng',       lng      !== null ? String(lng)      : '');
        set('geoAccuracy',  accuracy !== null ? String(accuracy) : '');
        set('geoTimestamp', ts       || '');
        set('geoStatus',    status   || '');
    }

    if (!navigator.geolocation) {
        setStatus('⚠️', 'Location not supported by this browser.', '#fff8e1', '#f0c040');
        setGeoFields(null, null, null, '', 'not_supported');
        return;
    }

    setStatus('📍', 'Fetching location… (please allow when prompted)', '#f0f4f8', '#d0dce8');

    navigator.geolocation.getCurrentPosition(
        pos => {
            const { latitude, longitude, accuracy } = pos.coords;
            const ts = new Date().toISOString();
            setGeoFields(latitude, longitude, Math.round(accuracy), ts, 'ok');
            const accLabel = accuracy < 50 ? 'high' : accuracy < 200 ? 'medium' : 'low';
            setStatus('✅', `Location captured (accuracy: ±${Math.round(accuracy)} m, ${accLabel})`, '#e8f5e9', '#6dbf7e');
        },
        err => {
            const msgs = {
                1: 'Location access denied by user.',
                2: 'Location unavailable (device/network error).',
                3: 'Location request timed out.',
            };
            setStatus('❌', msgs[err.code] || 'Location error.', '#fdecea', '#e57373');
            setGeoFields(null, null, null, new Date().toISOString(), `error_${err.code}`);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

// ===== END DEVICE ID & GEOLOCATION =====

/**
 * [FIX #2]
 * This is the new initialization block. It waits for the page
 * to be fully loaded, THEN it finds all the HTML elements
 * and assigns them to the global variables.
 * It also attaches all the necessary event listeners.
 */
document.addEventListener("DOMContentLoaded", async () => {
    // --- Assign all DOM elements to global variables ---
    form = document.getElementById("surveyForm");
    tableBody = document.querySelector("#responseTable tbody");
    const pageOrder = [
        'page-0-consent',
        'page-2-B',          // Section A Part 1: group profile + Shrine selection
        'page-2B-journey',   // Section A Part 2: main-haul journey
        'page-2C-lastmile',  // Section A Part 3: last-mile journey and stay
        'page-3-C',          // Section B: Main-Haul DCE
        'page-4-C-last-mile',// Section C: Last-Mile DCE
        'page-5-acceptance', // Railway and ropeway acceptance
        'page-5-D',          // Section D: Priorities & Attitudes
        'page-1-E',          // Section E: Demographics
        'page-6-F',          // Section F: Feedback
        'page-7-thankyou'
    ];
    pages = pageOrder.map(id => document.getElementById(id)).filter(Boolean);
    steps = Array.from(document.getElementsByClassName("step"));
    pageBackground = document.getElementById("pageBackground");
    googleSheetTarget = document.getElementById("googleSheetTarget");
    primaryModeTableBody = document.querySelector('#primaryModeTable tbody');
    lastMileTableBody = document.querySelector('#lastMileTable tbody');
    stayDurationTableBody = document.querySelector('#stayDurationTable tbody');
    restLocationTableBody = document.querySelector('#restLocationTable tbody');
    dhamCheckboxes = document.querySelectorAll('.current-dham-checkbox');
    choiceBlockInput = document.getElementById('choiceBlock');
    googleTranslateElement = document.getElementById('google_translate_element');
    floatingTranslateMount = document.getElementById('floatingTranslateMount');
    consentTranslateMount = document.getElementById('consentTranslateMount');
    surveyStartTimestampInput = document.getElementById('surveyStartTimestamp');
    surveySubmitTimestampInput = document.getElementById('surveySubmitTimestamp');
    surveyCompletionSecondsInput = document.getElementById('surveyCompletionSeconds');

    initDeviceId();
    initDeviceFingerprint();
    initGeolocation();

    lockEnglishOptionValues(form);
    initializeSurveyTiming();

    window.addEventListener('googleTranslateReady', () => updateTranslatePlacement(currentTab));

    await loadChoiceCardData();
    assignChoiceBlock();

    // --- Attach Event Listeners ---
    // These listeners replace the need for some `onclick` attributes
    
    // A4.1 Add Row
    // A6 Add Row
    document.getElementById("addRestLocationRow").addEventListener('click', addRestLocationRow);
    // A2 Travel Type
    document.getElementById('travelType').addEventListener('change', handleTravelTypeChange);
    document.getElementById('budgetScopeBlock').addEventListener('change', handleBudgetScopeChange);
    document.getElementById('onwardVehicleContinuity').addEventListener('change', handleOnwardVehicleContinuity);
    document.getElementById('startPoint').addEventListener('change', handleStartPointChange);
    document.getElementById('otherStartPoint').addEventListener('input', () => {
        updateMainHaulHeadings();
        updatePrimaryModeRouteCells();
    });
    form.addEventListener('change', event => {
        if (event.target.matches('select[name^="lastMileCostBand_"]')) updateLastMileCostChoice(event.target.closest('[id^="last-mile-row-"]'));
        if (event.target.matches('select[name^="stayAccomCostRange_"]')) updateAccommodationCosts();
        if (event.target.matches('select[name^="lastMileTimeBand_"]')) {
            updateLastMileTimeChoice(event.target.closest('[id^="last-mile-row-"]'));
        }
        if (event.target.matches('select[name^="restPurpose_"], select[name^="restDurationChoice_"], select[name^="restCostChoice_"]')) {
            updateStopoverChoices(event.target);
        }
        if (event.target.matches('input[name="tripStatus"], .current-dham-checkbox')) {
            updateOngoingDhamStatus();
        }
        if (event.target.matches('select, input[type="checkbox"]')) {
            updateOtherSpecifyField(event.target);
        }
        if (event.target.matches('select[name^="lastMileMode_"]')) {
            handleLastMileModeChange(event.target);
        }
        if (event.target.matches('input[type="radio"][name^="primaryMode_"]')) {
            updatePrimaryModeOther(event.target);
            updatePrimaryModeSpecificFields(event.target);
            updateVehicleOccupancyButtons(event.target);
            updateLastMileTable();
        }
        if (event.target.matches('input[name^="primaryHelicopterScope_"], input[name^="primaryHelicopterCoveredDhams_"]')) {
            if (event.target.name.startsWith('primaryHelicopterCoveredDhams_')) {
                const selected = event.target.closest('tr')?.querySelectorAll('input[name^="primaryHelicopterCoveredDhams_"]:checked') || [];
                const scope = event.target.closest('tr')?.querySelector('input[name^="primaryHelicopterScope_"]:checked')?.value || '';
                const maximum = scope === 'Single Dham shuttle' ? 1 : Infinity;
                if (selected.length > maximum) event.target.checked = false;
            }
            updateHelicopterScopeUI(event.target);
        }
        if (event.target.matches('input[type="radio"][name^="interDhamMode_"], input[type="radio"][name^="interDhamTransferMode_"], input[type="radio"][name^="mainHaulTransferMode_"], input[type="radio"][name^="returnMode_"]')) {
            updateVehicleOccupancyButtons(event.target);
            if (event.target.name.startsWith('interDhamMode_') || event.target.name.startsWith('interDhamTransferMode_')) updateLastMileTable();
        }
        if (event.target.matches('input[type="radio"][name^="primaryTime_"], input[type="radio"][name^="primaryCost_"], input[type="radio"][name^="mainHaulTransferTime_"], input[type="radio"][name^="mainHaulTransferCost_"]')) {
            syncPrimaryRangeSelection(event.target);
        }
        const returnCard = event.target.closest('.last-mile-return-card');
        if (returnCard) updateLastMileReturnDetails(returnCard.id.replace('last-mile-return-', ''));
        if (event.target.matches('input[name="lastMileApproachMode_Kedarnath"], select[name="lastMileApproachWaitingRange_Kedarnath"], select[name="lastMileApproachTimeBand_Kedarnath"]')) {
            updateKedarnathApproachDetails();
        }
        if (event.target.matches('input[name="kedarnathAccessType"]')) {
            updateKedarnathAccessUI();
        }
        if (event.target.matches('input[name="lastMileApproachMode_HemkundSahib"], select[name="lastMileApproachWaitingRange_HemkundSahib"], select[name="lastMileApproachTimeBand_HemkundSahib"]')) {
            updateHemkundTaxiDetails();
        }
        if (event.target.closest('#hemkundMountainDetails')) {
            updateHemkundMountainDetails();
        }
        if (event.target.matches('select[name^="mainHaulTransferCount_"]')) {
            updatePrimaryModeTable();
        }
        if (event.target.matches('select[name^="interDhamTransferCount_"]')) {
            updateInterDhamTable();
        }
        if (event.target.matches('input[name="kedarnath"], input[name="badrinath"], input[name="gangotri"], input[name="yamunotri"], input[name="hemkund"]')) {
            updateRepeatVisitReasonVisibility();
        }
        if (event.target.matches('input[name="ropewayGate"]')) updateModeBlockVisibility('ropeway');
        if (event.target.matches('input[name="railGate"]')) updateModeBlockVisibility('rail');
        if (event.target.matches('input[name="ropewayNoReason"][value="other"]')) {
            const otherDiv = document.getElementById('ropewayNoReasonOther');
            if (otherDiv) otherDiv.style.display = event.target.checked ? '' : 'none';
        }
        if (event.target.matches('input[name="railNoReason"][value="other"]')) {
            const otherDiv = document.getElementById('railNoReasonOther');
            if (otherDiv) otherDiv.style.display = event.target.checked ? '' : 'none';
        }
        renderJourneyPreviews();
    });
    form.addEventListener('input', event => {
        if (event.target.matches('input[name^="mainHaulTransferLocation_"]')) {
            updatePrimaryModeRouteCells();
        }
        if (event.target.matches('input[name^="interDhamTransferLocation_"]')) {
            const transferRow = event.target.closest('tr[data-inter-transfer-pair]');
            if (transferRow) updateInterDhamRouteLabel(transferRow.dataset.interTransferPair);
        }
        if (event.target.matches('#otherStartPoint, input[name^="mainHaulTransferLocation_"], input[name^="mainHaulTransferTime_"], input[name^="mainHaulTransferCost_"], input[name^="interDhamTransferLocation_"], input[name^="interDhamTransferTime_"], input[name^="interDhamTransferCost_"], input[name^="restLocation_"][name$="_otherSpecify"], input[name^="primaryMode_"][name$="_otherSpecify"], input[name^="primaryTime_"], input[name^="primaryCost_"], input[name^="interDhamTime_"], input[name^="interDhamCost_"], input[name="returnRoute[]"], input[name="returnTime[]"], input[name="returnCost[]"], input[name^="lastMileTime_"], input[name^="lastMileCost_"], input[name^="lastMileReturnTime_"], input[name^="lastMileReturnCost_"], input[name^="lastMileApproachTime_"], input[name^="lastMileApproachCost_"], input[name^="lastMileApproachWaitingTime_"], input[name^="lastMileApproachMountain"], input[name^="kedarnathHelicopter"], input[name="kedarnathHelicopterBoardingPoint_otherSpecify"]')) {
            renderJourneyPreviews();
        }
    });
    document.getElementById('groupSize').addEventListener('input', validateGroupComposition);
    document.getElementById('groupCompositionFields').addEventListener('input', event => {
        if (event.target.matches('input[type="number"]')) {
            validateGroupComposition();
        }
    });
    document.getElementById('dhamSequenceSelection').addEventListener('change', event => {
        if (event.target.matches('select[name^="dhamSequence_"]')) {
            event.target.dataset.selectedDham = event.target.value;
            refreshDhamSequenceOptions();
            updatePrimaryModeTable();
            updateInterDhamTable();
        }
    });

    // A2 Shrine Checkboxes
    dhamCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            updatePrimaryModeTable();
            updateRestLocationTable();
            updateDhamSequenceDropdowns();
            updateInterDhamTable();
            updateLastMileTable();
            initializeDCE(); // This will now be called correctly
        });
    });

    // Export Buttons
    document.getElementById("selectAllLocalResponses").addEventListener("click", selectAllLocalResponses);
    document.getElementById("deleteSelectedLocalResponses").addEventListener("click", deleteSelectedLocalResponses);
    document.getElementById("deleteAllLocalResponses").addEventListener("click", deleteAllLocalResponses);
    document.getElementById("exportCSV").addEventListener("click", exportToCSV);
    document.getElementById("exportXLSX").addEventListener("click", exportToXLSX);
    
    // --- Initialize App State ---
    responses = JSON.parse(localStorage.getItem("charDhamSurvey")) || [];
    renderTable();
    enhanceRatingTables();
    
    updatePrimaryModeTable();
    updateRestLocationTable();
    updateOngoingDhamStatus();
    // Show the first page (Page 0)
    showTab(currentTab); 
    updateTranslatePlacement(currentTab);
    
    // Initialize group size logic
    handleTravelTypeChange();
    handleOnwardVehicleContinuity();
    handleStartPointChange();
    updateMainHaulHeadings();
    updateRepeatVisitReasonVisibility();
    initializeOtherSpecifyFields();
    renderJourneyPreviews();
    initializeSurveyDraft();
});
