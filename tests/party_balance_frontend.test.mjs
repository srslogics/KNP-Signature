import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = name => fs.readFileSync(new URL(`../frontend/js/${name}.js`, import.meta.url), 'utf8');
function context(extra = {}) {
  return vm.createContext({console, URLSearchParams, setTimeout, clearTimeout,
    localStorage:{getItem:()=>null}, ...extra});
}

test('billing and both payment directions use the primary balance, including zero', () => {
  const app = context();
  vm.runInContext(source('retail'), app);
  for (const balance of [1250, 0, -100]) {
    const profile = {balance_after:balance, receivable_balance:-200, payable_balance:1400};
    assert.equal(app.getPartyDisplayBalance(profile), balance);
    assert.equal(app.getPartyPaymentBalance(profile), balance);
    assert.equal(app.partyHasResolvedBalance(profile), true);
  }
  assert.equal(app.partyHasResolvedBalance({receivable_balance:100}), false);
});

for (const type of ['Dealer', 'Vendor']) {
  test(`${type} WhatsApp uses the primary party balance`, async () => {
    const values = {'.dealerParty':'Example', '.vendorParty':'Example'};
    const row = {querySelector:selector=>({value:values[selector] || '1'})};
    let captured;
    const app = context({document:{getElementById:()=>({value:'2026-09-03'})}});
    vm.runInContext(source('upload'), app);
    app.fetchUploadPartyDetails = async () => ({phone:'919999999999',balance:1250,receivable:-200,payable:1400});
    app.openUploadWhatsApp = (phone, message) => {captured={phone,message};};
    app.showToast = () => {};
    await app[`send${type}EntryOnWhatsApp`]({closest:()=>row});
    assert.match(captured.message, /Balance: Rs 1,250\.00/);
    assert.doesNotMatch(captured.message, /1,400\.00|-200\.00/);
    assert.equal(captured.phone, '919999999999');
  });
}

function element() {
  return {children:[], value:'', innerText:'',
    set innerHTML(value) {this.children=[]; this.markup=value;},
    appendChild(child) {this.children.push(child);},
    querySelector() {return this.children[0] ||= element();}};
}

test('ledger renders one running Balance column and carries an empty period opening', async () => {
  const fields = Object.fromEntries(['party','ledgerStartDate','ledgerEndDate','ledgerBody','totalBalance','partySummary'].map(id=>[id,element()]));
  fields.party.value='Example';
  let response = {total_balance:1250,summary:{opening_balance:1000,total_sales:50,total_purchase:500,total_received:200,total_paid:100},
    ledger:[{date:'2026-09-03',type:'SALE',amount:50,balance:1250}]};
  const app = context({document:{getElementById:id=>fields[id],createElement:element},
    apiCall:async()=>response,showToast:()=>{}});
  vm.runInContext(source('ledger'), app);
  await app.searchLedger();
  assert.match(fields.totalBalance.innerText,/1,250/);
  assert.equal(fields.ledgerBody.children[0].children.length,6);
  assert.match(fields.ledgerBody.children[0].children[5].innerText,/1,250/);
  assert.equal(fields.partySummary.children[0].children[0].innerText,'Opening Balance');
  response={...response,ledger:[]};
  await app.searchLedger();
  assert.match(fields.totalBalance.innerText,/1,250/);
  assert.match(fields.ledgerBody.markup,/colspan="6"/);
});

test('ledger switches to receivable and payable columns from the cutover', async () => {
  const fields = Object.fromEntries([
    'party','ledgerStartDate','ledgerEndDate','ledgerBody','ledgerHead','totalBalance',
    'receivableBalance','payableBalance','partySummary'
  ].map(id=>[id,element()]));
  fields.party.value='AMAR';
  const accountCards = [{hidden:true},{hidden:true}];
  const table = {classList:{toggle:()=>{}}};
  const app = context({document:{
    getElementById:id=>fields[id], createElement:element,
    querySelectorAll:()=>accountCards,
    querySelector:selector=>selector==='.ledger-table' ? table : null
  }, apiCall:async()=>({
    ledger_mode:'account', total_balance:156386.84,
    balances:{receivable:156386.84,payable:0},
    summary:{opening_receivable:0,opening_payable:0,total_sales:0,total_purchase:0,total_received:0,total_paid:0},
    ledger:[{date:'2026-09-05',account:'RECEIVABLE',type:'OPENING RECEIVABLE',amount:156386.84,
      debit:156386.84,credit:0,account_balance:156386.84,net_balance:156386.84}]
  }), showToast:()=>{}});
  vm.runInContext(source('ledger'), app);
  await app.searchLedger();
  assert.equal(accountCards.every(card=>card.hidden===false),true);
  assert.match(fields.receivableBalance.innerText,/156,386\.84/);
  assert.equal(fields.ledgerBody.children[0].children.length,9);
  assert.equal(fields.partySummary.children[0].children[0].innerText,'Opening Receivable');
});
