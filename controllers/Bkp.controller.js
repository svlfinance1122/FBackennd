const BkpModel = require('../models/Bkp.model');

// Supports single object or array
const saveBkp = async (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    const results = [];
    const errors = [];

    for (const item of items) {
      const { id, sNo, name, amount, area } = item;

      if (sNo === undefined || !name || amount === undefined || !area) {
        errors.push({ sNo, name, message: 'sNo, name, amount, area are required' });
        continue;
      }

      if (id) {
        const record = await BkpModel.findByPk(id);
        if (record) {
          await record.update({ sNo, name, amount, area });
          results.push({ action: 'updated', data: record });
          continue;
        }
      }

      const entry = await BkpModel.create({ sNo, name, amount, area });
      results.push({ action: 'created', data: entry });
    }

    return res.status(201).json({
      success: true,
      message: `${results.length} BKP entry(ies) processed successfully`,
      data: results.length === 1 ? results[0] : results,
      ...(errors.length > 0 && { errors }),
    });
  } catch (err) {
    next(err);
  }
};

const deleteBkp = async (req, res, next) => {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ success: false, message: 'id is required (use /bkp/delete/:id or /bkp/delete?id=UUID)' });
    }

    const record = await BkpModel.findByPk(id);

    if (!record) {
      return res.status(404).json({ success: false, message: 'BKP entry not found' });
    }

    await record.destroy();

    return res.status(200).json({ success: true, message: 'BKP entry deleted' });
  } catch (err) {
    next(err);
  }
};

const getAllBkp = async (req, res, next) => {
  try {
    const rows = await BkpModel.findAll({
      order: [['sNo', 'ASC']]
    });
    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    next(err);
  }
};

const editBkp = async (req, res, next) => {
  try {
    const { id, sNo, name, amount, area } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, message: 'id is required' });
    }

    const record = await BkpModel.findByPk(id);

    if (!record) {
      return res.status(404).json({ success: false, message: 'BKP entry not found' });
    }

    await record.update({ sNo, name, amount, area });

    return res.status(200).json({
      success: true,
      message: 'BKP entry updated successfully',
      data: record,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { saveBkp, deleteBkp, getAllBkp, editBkp };
