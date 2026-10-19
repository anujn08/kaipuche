window.phoneFill = async ({ profile, donor, model, fieldDelay, pageBudgetSeconds, pageStarted }) => {
          const page = pages[currentTab];
          const touched = new Set();
          const log = [];
          const dceNames=[...new Set([...page.querySelectorAll('input[type="radio"][name]')].map(c=>c.name).filter(name=>/^(main_haul|last_mile)_.*Task/.test(name)))];
          const readCards=new Set();
          const visible = el => isEffectivelyVisible(el) && el.type !== 'hidden' && !el.readOnly;
          const decide = el => {
            const group = [...page.querySelectorAll('input[name],select[name],textarea[name]')].filter(c => c.name === el.name && visible(c));
            const choices = el.tagName === 'SELECT' ? [...el.options].filter(o => o.value && !o.disabled && !o.hidden).map(o => o.value)
              : ['radio', 'checkbox'].includes(el.type) ? group.map(c => c.value) : [];
            const values = {};
            for (const c of form.querySelectorAll('[name]')) {
              if (c.disabled || (['radio','checkbox'].includes(c.type) && !c.checked)) continue;
              if (c.value !== '') values[c.name] = c.value;
            }
            const cards = /^main_haul_|^last_mile_/.test(el.name) ? group.map(c => {
              const card = c.closest('.dce-card');
              const attributes = [...(card?.querySelectorAll('.dce-attr') || [])];
              const attr = label => attributes.find(a => a.querySelector('.dce-label')?.textContent === label)?.querySelector('.dce-value')?.textContent || '';
              const level = text => /High|Very High|Luxury/.test(text) ? 3 : /Medium/.test(text) ? 2 : 1;
              return { value: c.value, cost: Number(attr('Cost').replace(/[^0-9.]/g,'')), time: parseFloat(attr('Travel Time')), comfort: level(attr('Comfort')), reliability: level(attr('Reliability')) };
            }) : [];
            return window.answerPolicy.chooseAnswer({ name: el.name, type: el.type, options: choices, required: group.some(c => c.required), profile, donor, model, values, cards });
          };
          const change = async (el, value, decision) => {
            if(decision.alternatives && pageBudgetSeconds && !readCards.has(el.name)){
              const index=dceNames.indexOf(el.name);
              const deadline=pageStarted+pageBudgetSeconds*1000*(0.15+0.85*(index+1)/dceNames.length);
              const banner=document.getElementById('bot-live-status');
              banner.textContent=`${profile.label || profile.id} • Reading choice card ${index+1} of ${dceNames.length}`;
              await window.reportBotField({name:'Reading choice card',value:`${index+1} of ${dceNames.length}`,source:'section-pacing'});
              el.closest('.dce-task')?.scrollIntoView({block:'center',behavior:'instant'});
              const remaining=deadline-Date.now();
              if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
              readCards.add(el.name);
            }
            if (fieldDelay) {
              el.scrollIntoView({ block: 'center', behavior: 'instant' });
              el.style.outline = '3px solid #e89518';
              const banner = document.getElementById('bot-live-status');
              banner.textContent = `${profile.label || profile.id} • ${el.name}: ${value}`;
              await new Promise(resolve => setTimeout(resolve, fieldDelay));
            }
            if (!el.isConnected) return;
            if (el.type === 'radio' || el.type === 'checkbox') el.checked = true;
            else el.value = String(value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            log.push({ name: el.name, value: el.value, displayValue: el.tagName === 'SELECT' ? el.selectedOptions[0]?.textContent.trim() : ['radio','checkbox'].includes(el.type) ? el.nextElementSibling?.textContent.trim() || el.value : el.value, source: decision.source, support: decision.support || 0,
              ...(decision.alternatives ? { displayedCards: decision.alternatives } : {}) });
            await window.reportBotField({ name: el.name, value: el.value, source: decision.source, support: decision.support || 0 });
            if (fieldDelay) {
              await new Promise(resolve => setTimeout(resolve, fieldDelay / 2));
              el.style.outline = '';
            }
          };
          for (let pass = 0; pass < 30; pass++) {
            let changed = false;
            for (const el of page.querySelectorAll('input[name],select[name],textarea[name]')) {
              if (!el.isConnected || !visible(el)) continue;
              const key = el.type === 'checkbox' ? el.name + ':' + el.value : el.name;
              if (touched.has(key) && (el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value !== '' || !el.required)) continue;
              if (el.name === 'luckyDrawUpi' && !Object.hasOwn(profile.answers || {}, el.name)) continue;
              const decision = decide(el);
              if (decision.value === null || decision.value === undefined) {
                if (el.required && el.type !== 'checkbox') throw Error(`No supported answer for ${el.name} (${decision.source}). Add an explicit profile override.`);
                continue;
              }
              if (el.type === 'checkbox') {
                if (![].concat(decision.value).includes(el.value)) continue;
                if (el.checked) { touched.add(key); continue; }
              } else if (el.type === 'radio') {
                const group = [...page.querySelectorAll('input[type="radio"]')].filter(c => c.name === el.name && visible(c));
                if (group.some(c => c.checked)) { touched.add(key); continue; }
                if (String(decision.value) !== el.value) continue;
              } else if (el.tagName === 'SELECT') {
                const options = [...el.options].filter(o => o.value && !o.disabled && !o.hidden);
                if (!options.length) continue;
                await change(el, decision.value, decision);
                touched.add(key); changed = true; continue;
              } else {
                if (['number','range'].includes(el.type) && !Number.isFinite(Number(decision.value))) throw Error(`Legacy nonnumeric value for ${el.name}; supply an explicit numeric override`);
                await change(el, decision.value, decision); touched.add(key); changed = true; continue;
              }
              await change(el, el.value, decision); touched.add(key); changed = true;
            }
            if (!changed) return log;
          }
          throw Error('Conditional fields did not stabilize after 30 passes: ' + JSON.stringify(log.slice(-12)));
};
