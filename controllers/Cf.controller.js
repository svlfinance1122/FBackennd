const CfModel = require('../models/Cf.model');

// Supports single object or array
const saveCf = async (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    const results = [];
    const errors = [];

    for (const item of items) {
      const { id, sNo, date, amount } = item;

      if (sNo === undefined || !date || date === "Invalid date" || amount === undefined) {
        errors.push({ sNo, date, message: 'A valid date, sNo and amount are required' });
        continue;
      }

      if (id) {
        const record = await CfModel.findByPk(id);
        if (record) {
          await record.update({ sNo, date, amount });
          results.push({ action: 'updated', data: record });
          continue;
        }
      }

      const entry = await CfModel.create({ sNo, date, amount });
      results.push({ action: 'created', data: entry });
    }

    return res.status(201).json({
      success: true,
      message: `${results.length} CF entry(ies) processed successfully`,
      data: results.length === 1 ? results[0] : results,
      ...(errors.length > 0 && { errors }),
    });
  } catch (err) {
    next(err);
  }
};

const clearCf = async (req, res, next) => {
  try {
    await CfModel.destroy({ where: {}, truncate: true });

    return res.status(200).json({
      success: true,
      message: 'All CF entries cleared',
    });
  } catch (err) {
    next(err);
  }
};

// optional helper to get all CF entries (useful for testing)
const getAllCf = async (req, res, next) => {
  try {
    const rows = await CfModel.findAll({
      order: [['sNo', 'ASC']]
    });
    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    next(err);
  }
};

const deleteCf = async (req, res, next) => {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ success: false, message: 'id is required' });
    }

    const record = await CfModel.findByPk(id);

    if (!record) {
      return res.status(404).json({ success: false, message: 'CF entry not found' });
    }

    await record.destroy();

    return res.status(200).json({ success: true, message: 'CF entry deleted' });
  } catch (err) {
    next(err);
  }
};

const editCf = async (req, res, next) => {
  try {
    const { id, sNo, date, amount } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, message: 'id is required' });
    }

    const record = await CfModel.findByPk(id);

    if (!record) {
      return res.status(404).json({ success: false, message: 'CF entry not found' });
    }

    await record.update({ sNo, date, amount });

    return res.status(200).json({
      success: true,
      message: 'CF entry updated successfully',
      data: record,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { saveCf, clearCf, getAllCf, deleteCf, editCf };