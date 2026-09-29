// Simple in-memory cart. No backend calls here — just client-side state.
//
// Each cart entry is a "line": one food item plus one specific combination of
// add-ons (e.g. "Chicken Biriyani + Extra Chicken + Boiled Egg"). Adding the
// same item with a different set of add-ons creates a separate line, so
// quantities and prices never get mixed up between combinations.
const Cart = (function () {
  let lines = {}; // lineKey -> { lineKey, itemId, name, price, food_type, addons: [{id,name,price}], quantity }

  function lineKeyFor(itemId, addonIds) {
    const sorted = [...addonIds].map(Number).sort((a, b) => a - b);
    return `${itemId}::${sorted.join(',')}`;
  }

  // item: the menu item. addons: array of {id, name, price} the patient selected. quantity: integer >= 1.
  function addLine(item, addons, quantity) {
    const addonIds = (addons || []).map(a => a.id);
    const key = lineKeyFor(item.id, addonIds);
    if (lines[key]) {
      lines[key].quantity += quantity;
    } else {
      lines[key] = {
        lineKey: key,
        itemId: item.id,
        name: item.name,
        price: Number(item.price),
        food_type: item.food_type,
        addons: (addons || []).map(a => ({ id: a.id, name: a.name, price: Number(a.price) })),
        quantity
      };
    }
  }

  function removeLine(lineKey) {
    delete lines[lineKey];
  }

  function increaseLine(lineKey) {
    if (lines[lineKey]) lines[lineKey].quantity += 1;
  }

  function decreaseLine(lineKey) {
    if (!lines[lineKey]) return;
    lines[lineKey].quantity -= 1;
    if (lines[lineKey].quantity <= 0) delete lines[lineKey];
  }

  function getLines() {
    return Object.values(lines);
  }

  // Total quantity already in the cart for a given menu item, across every add-on combination.
  // Used to show "N in cart" on the menu card.
  function getQuantityForItem(itemId) {
    return getLines()
      .filter(l => l.itemId === itemId)
      .reduce((sum, l) => sum + l.quantity, 0);
  }

  function lineUnitPrice(line) {
    const addonsTotal = line.addons.reduce((sum, a) => sum + a.price, 0);
    return line.price + addonsTotal;
  }

  function lineAmount(line) {
    return Math.round(lineUnitPrice(line) * line.quantity * 100) / 100;
  }

  function getTotalCount() {
    return getLines().reduce((sum, l) => sum + l.quantity, 0);
  }

  function getTotalAmount() {
    return Math.round(getLines().reduce((sum, l) => sum + lineAmount(l), 0) * 100) / 100;
  }

  function clear() {
    lines = {};
  }

  return {
    addLine, removeLine, increaseLine, decreaseLine,
    getLines, getQuantityForItem, lineUnitPrice, lineAmount,
    getTotalCount, getTotalAmount, clear
  };
})();
