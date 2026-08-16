// Simple in-memory cart. No backend calls here — just client-side state.
const Cart = (function () {
  let items = {}; // itemId -> { id, name, price, food_type, quantity }

  function add(item) {
    if (items[item.id]) {
      items[item.id].quantity += 1;
    } else {
      items[item.id] = {
        id: item.id,
        name: item.name,
        price: Number(item.price),
        food_type: item.food_type,
        quantity: 1
      };
    }
  }

  function increase(id) {
    if (items[id]) items[id].quantity += 1;
  }

  function decrease(id) {
    if (!items[id]) return;
    items[id].quantity -= 1;
    if (items[id].quantity <= 0) delete items[id];
  }

  function remove(id) {
    delete items[id];
  }

  function getQuantity(id) {
    return items[id] ? items[id].quantity : 0;
  }

  function getItems() {
    return Object.values(items);
  }

  function getTotalCount() {
    return getItems().reduce((sum, it) => sum + it.quantity, 0);
  }

  function getTotalAmount() {
    return getItems().reduce((sum, it) => sum + it.quantity * it.price, 0);
  }

  function clear() {
    items = {};
  }

  return { add, increase, decrease, remove, getQuantity, getItems, getTotalCount, getTotalAmount, clear };
})();
