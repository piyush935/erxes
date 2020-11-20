import { getConfig } from 'erxes-api-utils';

export const loyaltySchema = {
  modifiedAt: { type: Date, label: 'Modified at' },
  customerId: { type: String, label: 'Customer', index: true },
  value: { type: Number, label: 'Value' },
  dealId: { type: String, label: 'Deal', optional: true, index: true },
  userId: { type: String, optional: true, label: 'User' },
};

class Loyalty {
  public static async getLoyaltyValue(models, customerId, excludeDealId = null) {
    let match: any = { customerId: customerId };

    if (excludeDealId) {
      match = { $and: [{ customerId: customerId }, { dealId: { $ne: excludeDealId } }] };
    }
    console.log(match)

    const response = await models.Loyalties.aggregate([
      { $match: match },
      { $group: { _id: customerId, sumLoyalty: { $sum: "$value" } } }
    ]);
    console.log(response)
    if (!response.length) {
      return 0;
    }

    return response[0].sumLoyalty
  }

  public static async getLoyalties(models, customerId) {
    return models.Loyalties.find({
      customerId
    }).sort({ modifiedAt: 1 })
  }

  static async getLoyaltyOfDeal(models, customer, deal) {
    return models.Loyalties.findOne({ customerId: customer._id, dealId: deal._id })
  }

  public static async addLoyalty(models, customer, value: number, user = null) {
    if (value <= 0) {
      return;
    }

    return models.Loyalties.create({
      customerId: customer._id,
      value,
      modifiedAt: new Date(),
      userId: user?._id
    })
  }

  public static async minusLoyalty(models, customer, amount: number, user = null) {
    if (amount === 0) {
      return;
    }

    const fixAmount = amount > 0 ? -1 * amount : amount;

    return models.Loyalties.create({
      customerId: customer._id,
      value: fixAmount,
      modifiedAt: new Date(),
      userId: user?._id
    })
  }

  public static async CalcLoyalty(models, deal) {
    const amounts = deal.productsData?.map(item => item.tickUsed ? item.amount || 0 : 0) || [];
    const sumAmount = amounts.reduce((preVal, currVal) => {
      return preVal + currVal
    })

    return this.convertCurrencyToLoyalty(sumAmount);
  }

  static async UseLoyalty(deal) {
    const ratio = await getConfig('LOYALTY_RATIO_CURRENCY', 1);
    return (deal.paymentsData?.loyalty?.amount || 0) / ratio;
  }

  public static async convertLoyaltyToCurrency(models, value: number) {
    const ratio = await getConfig('LOYALTY_RATIO_CURRENCY', 1);
    return value * ratio;
  }

  static async convertCurrencyToLoyalty(currency: number) {
    const percent = await getConfig('LOYALTY_PERCENT_OF_DEAL', 0);
    return currency / 100 * percent;
  }

  public static async dealChangeCheckLoyalty(models, deal, stageId: string, user = null) {
    const customerIds = await models.Conformities.savedConformity({ mainType: 'deal', mainTypeId: deal._id, relTypes: ['customer'] });
    if (!customerIds) {
      return;
    }

    const customers = await models.Customers.find({ _id: { $in: customerIds } });
    const stage = await models.Stages.getStage(stageId);
    let valueForDeal = 0;
    let valueForUse = 0;
    if (stage.probability === "Won") {
      valueForDeal += await this.CalcLoyalty(models, deal);
      valueForUse += await this.UseLoyalty(deal);
    }

    const value = (valueForDeal - valueForUse) / (customers.length || 1);

    for (const customer of customers) {
      const loyalty = await this.getLoyaltyOfDeal(models, customer, deal);

      const limit = await models.Loyalties.getLoyaltyValue(models, customer, deal._id)

      if (limit < value * -1) {
        throw new Error('The loyalty used exceeds the accumulated loyalty.');
      }

      const doc = {
        customerId: customer._id,
        modifiedAt: new Date(),
        value,
        dealId: deal._id,
        userId: user?._id,
      }

      if (loyalty) {
        await models.Loyalties.updateOne({ _id: loyalty._id }, { $set: doc })
      } else {
        await models.Loyalties.create(doc);
      }
    }
    return
  }

  public static async deleteLoyaltyOfDeal(models, dealId: string) {
    return models.Loyalties.deleteOne({ dealId })
  }
}

export default [
  {
    name: 'Loyalties',
    schema: loyaltySchema,
    klass: Loyalty
  },
];
